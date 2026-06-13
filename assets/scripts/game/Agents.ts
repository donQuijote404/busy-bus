import { Node, Vec3 } from 'cc';
import { GameColor } from '../data/GameTypes';
import { Path } from '../path/Path';

export enum VehicleState {
    /** Đứng trong hàng chờ (hoặc đang tự dồn lên slot trống phía trước). */
    InQueue = 'InQueue',
    /** Từ hàng chờ / chỗ đậu chạy tới điểm vào vòng (đường phụ phía nam). */
    ToEntry = 'ToEntry',
    /** Đang chạy trên vòng đường chính. */
    OnLoop = 'OnLoop',
    /** Dừng/bò chậm ở bến, đang đón khách từng người một. */
    Boarding = 'Boarding',
    /** Đã đầy khách, đang rẽ ra cổng Barrier. */
    ToExit = 'ToExit',
    /** Hết vòng mà chưa đầy → đang chạy về chỗ đậu (hoặc về điểm thua nếu parkingSlot=-1). */
    ToParking = 'ToParking',
    /** Đứng yên trong chỗ đậu, tap được để chạy tiếp một vòng. */
    Parked = 'Parked',
    /** Đã ra khỏi map — trạng thái kết thúc của xe thắng cuộc. */
    Out = 'Out',
}

/**
 * Một chiếc xe bus. Plain class — không kế thừa Component; GameManager tick
 * tất cả VehicleAgent trong một update loop duy nhất.
 */
export class VehicleAgent {
    /** Màu xe — chỉ đón khách cùng màu. */
    readonly color: GameColor;
    /** Tổng số ghế (4/6/10, khớp mesh Vehicle_0X). */
    readonly seatsTotal: number;
    /** Số ghế còn trống; về 0 là xe "đầy" và sẽ rẽ ra cổng khi hết vòng. */
    seatsLeft: number;
    /** Thứ tự duy nhất để tie-break khi 2 xe chặn lẫn nhau (gán lúc startGame). */
    uid = 0;

    /** Trạng thái hiện tại trong FSM — xem {@link VehicleState}. */
    state = VehicleState.InQueue;
    /** Index hàng chờ xuất phát (giữ nguyên cả khi đã rời hàng — để debug/log). */
    queueIndex = -1;
    /** Slot đích trong hàng chờ, 0 = đầu hàng; -1 khi đã rời hàng. */
    queueSlot = -1;
    /** Slot bãi đậu đang giữ; -1 = không giữ slot (đặc biệt: ToParking với -1 = xe THUA đang về bãi). */
    parkingSlot = -1;

    /** Path đang chạy (tham chiếu dùng chung từ RoadNetwork, không clone). */
    path: Path | null = null;
    /** Quãng đường (m) đã đi trên path hiện tại — reset khi đổi path. */
    dist = 0;
    /** Bến tiếp theo cần kiểm tra trên loop (index trong network.stops, tăng dần). */
    nextStopIdx = 0;
    /** Đếm ngược (giây) tới lượt khách kế tiếp bước lên khi đang Boarding. */
    boardTimer = 0;

    /** Vị trí logic (world space) — view sync node theo đây, test chạy không cần node. */
    pos = new Vec3();
    /** Hướng nhìn logic (đơn vị) — view đổi thành yaw của node. */
    dir = new Vec3(0, 0, -1);
    /** Node 3D hiển thị; null khi chạy test trong editor (logic không phụ thuộc). */
    node: Node | null = null;

    constructor(color: GameColor, seats: number, queueIndex: number, queueSlot: number) {
        this.color = color;
        this.seatsTotal = seats;
        this.seatsLeft = seats;
        this.queueIndex = queueIndex;
        this.queueSlot = queueSlot;
    }

    /** Xe đã kín ghế chưa — điều kiện rẽ ra cổng thay vì vào bãi đậu. */
    get isFull(): boolean {
        return this.seatsLeft === 0;
    }
}

/** Máy trạng thái của hành khách: `Waiting → (xe cùng màu dừng bến) → Walking → Gone`. */
export enum PassengerState {
    /** Đứng/đi bộ dồn chỗ trong hàng chờ ở bến. */
    Waiting = 'Waiting',
    /** Đang đi bộ từ hàng lên cửa xe (walkFrom → walkTo theo walkT). */
    Walking = 'Walking',
    /** Đã lên xe — node bị ẩn, trạng thái kết thúc. */
    Gone = 'Gone',
}

/**
 * Một hành khách. Plain class như VehicleAgent — GameManager tick tập trung,
 * node 3D (stickman) là tuỳ chọn gắn sau.
 */
export class PassengerAgent {
    /** Màu khách — chỉ lên xe cùng màu. */
    readonly color: GameColor;
    /** Bến mà khách đứng chờ (index trong level.stops). */
    readonly stopIndex: number;
    /** Trạng thái hiện tại — xem {@link PassengerState}. */
    state = PassengerState.Waiting;

    pos = new Vec3();
    /** Hướng nhìn quanh trục Y (độ): đứng chờ nhìn ra đường, đi bộ nhìn theo hướng đi. */
    yaw = 0;
    /** Hướng nhìn khi đứng yên trong hàng (quay về phía đường). */
    idleYaw = 0;
    /** Vị trí slot hiện tại trong hàng — khách ĐI BỘ tới đây thay vì teleport. */
    queueTarget = new Vec3();
    /** Đang đi bộ dồn hàng (để view chuyển Idle↔Walk đúng lúc). */
    shifting = false;
    /** Điểm xuất phát của bước đi bộ lên xe (chốt tại thời điểm rời hàng). */
    walkFrom = new Vec3();
    /** Điểm đích của bước đi bộ — cập nhật mỗi frame bám theo xe đang bò chậm. */
    walkTo = new Vec3();
    /** Tiến độ đi bộ [0..1]; đạt 1 là khách lên xe xong (state → Gone). */
    walkT = 0;
    /** Xe đang lên — nguồn cập nhật walkTo vì xe vẫn bò chậm khi đón. */
    target: VehicleAgent | null = null;
    /** Node 3D stickman; null khi chạy test trong editor. */
    node: Node | null = null;

    constructor(color: GameColor, stopIndex: number) {
        this.color = color;
        this.stopIndex = stopIndex;
    }
}
