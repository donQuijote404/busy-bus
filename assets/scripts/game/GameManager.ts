import { Component, Vec3, _decorator } from 'cc';
import { GameColor, LevelData } from '../data/GameTypes';
import { LEVEL_1 } from '../data/Levels';
import { RoadNetwork, StopInfo } from '../path/RoadNetwork';
import { PassengerAgent, PassengerState, VehicleAgent, VehicleState } from './Agents';
import { CONFIG } from './GameConfig';

const { ccclass } = _decorator;

export enum GameState {
    Idle = 'Idle',
    Playing = 'Playing',
    /** Tất cả xe đã đầy khách và ra ngoài. */
    Won = 'Won',
    /** Một xe chưa đầy về tới bãi khi bãi đã kín chỗ. */
    Lost = 'Lost',
}

/**
 * Kết quả một lượt tap (input hợp lệ hay vì sao bị từ chối):
 * - `ok`: xe đã được phép đi;
 * - `not-playing`: ván chưa bắt đầu hoặc đã kết thúc;
 * - `empty`: hàng chờ rỗng;
 * - `capacity-full`: đường đã đủ `level.capacity` xe;
 * - `not-parked`: slot không có xe đậu hẳn (rỗng hoặc xe còn đang lăn bánh vào);
 * - `not-ready`: xe đầu hàng còn đang dồn lên, chưa đứng đúng vị trí xuất phát.
 */
export type TapResult = 'ok' | 'not-playing' | 'empty' | 'capacity-full' | 'not-parked' | 'not-ready';

/**
 * Sự kiện gameplay phát qua {@link GameManager.onEvent} cho lớp view/game-feel
 * đăng ký — logic không render gì, mọi hiệu ứng (nắp xe, barrier, animation
 * khách...) đều bám theo các sự kiện này:
 * - `dispatch`: xe rời hàng chờ / bãi đậu lên đường;
 * - `board-start`: MỘT khách bắt đầu bước lên xe;
 * - `lid-close`: khách cuối vừa lấp đầy xe (gắn hiệu ứng đóng nắp);
 * - `depart-stop`: xe rời bến (hết khách hợp lệ hoặc hết ghế);
 * - `exit-start` / `exited`: xe bắt đầu rẽ ra cổng / đã ra khỏi map;
 * - `parked`: xe vào chỗ đậu xong;
 * - `queue-shift`: hàng (xe hoặc khách) có biến động — view relayout nếu cần;
 * - `passenger-step` / `passenger-wait`: khách bắt đầu đi bộ dồn hàng / về lại đứng yên;
 * - `passenger-gone`: khách đã lên xe xong (ẩn node);
 * - `won` / `lost`: ván kết thúc.
 */
export type GameEvent =
    | { type: 'dispatch'; vehicle: VehicleAgent }
    | { type: 'board-start'; vehicle: VehicleAgent; passenger: PassengerAgent }
    | { type: 'lid-close'; vehicle: VehicleAgent }
    | { type: 'depart-stop'; vehicle: VehicleAgent }
    | { type: 'exit-start'; vehicle: VehicleAgent }
    | { type: 'exited'; vehicle: VehicleAgent }
    | { type: 'parked'; vehicle: VehicleAgent }
    | { type: 'queue-shift'; queueIndex: number }
    | { type: 'passenger-step'; passenger: PassengerAgent }
    | { type: 'passenger-wait'; passenger: PassengerAgent }
    | { type: 'passenger-gone'; passenger: PassengerAgent }
    | { type: 'won' }
    | { type: 'lost' };

@ccclass('GameManager')
export class GameManager extends Component {
    /** Trạng thái ván hiện tại — view chặn input khi khác Playing. */
    state = GameState.Idle;
    /** Level đang chơi (mặc định LEVEL_1, đổi được qua startGame). */
    level: LevelData = LEVEL_1;
    /** Nguồn path — component gắn cùng node, tự add nếu thiếu. */
    network: RoadNetwork = null!;

    /** Xe còn trong từng hàng chờ; phần tử 0 là xe đầu hàng (tap được). */
    queues: VehicleAgent[][] = [];
    /** Mọi xe trong ván (kể cả đã Out) — nguồn duy nhất để tick. */
    vehicles: VehicleAgent[] = [];
    /** Các bến thực sự có trong level (layout có thể nhiều bến hơn level dùng). */
    stops: StopInfo[] = [];
    /** Khách còn CHỜ ở từng bến (theo stop index); phần tử 0 là người đầu hàng. */
    stopQueues: PassengerAgent[][] = [];
    /** Mọi khách trong ván (kể cả đã Gone) — nguồn duy nhất để tick. */
    passengers: PassengerAgent[] = [];
    /** Xe đang giữ từng chỗ đậu; null = slot trống. */
    parking: (VehicleAgent | null)[] = [];

    /** Số xe đang đón khách tại mỗi bến (theo stop.index) — xe sau phải chờ bến trống. */
    private stopBusy: number[] = [];

    /** Số xe đang trên đường (ToEntry/OnLoop/Boarding/ToExit/ToParking) — so với level.capacity. */
    roadCount = 0;
    /** Số xe đã đầy khách và ra ngoài — bằng tổng số xe là THẮNG. */
    outCount = 0;
    /** Thời gian đã chơi (giây) — dùng cho log kết quả và benchmark 30-60s. */
    elapsed = 0;

    /** Hook duy nhất cho view/game feel — xem {@link GameEvent}. */
    onEvent: ((ev: GameEvent) => void) | null = null;
    /** Nhật ký sự kiện dạng text (phục vụ test + debug; không ghi passenger-step/wait). */
    eventLog: string[] = [];

    /**
     * Bắt đầu (hoặc chơi lại) một ván: build lại path network, tạo mới toàn bộ
     * agent từ level data, reset bộ đếm rồi chuyển state sang Playing.
     * Gọi lại lần nữa là restart sạch — không giữ gì từ ván trước.
     *
     * @param level Level muốn chơi; bỏ trống dùng LEVEL_1.
     */
    startGame(level?: LevelData): void {
        this.level = level ?? LEVEL_1;
        this.network = this.getComponent(RoadNetwork) ?? this.node.addComponent(RoadNetwork);
        this.network.rebuild();

        this.queues = this.level.queues.map((q, qi) =>
            q.vehicles.map((v, slot) => new VehicleAgent(v.color, v.seats, qi, slot)));
        // không dùng Array.flat() (ES2019) — target ES2015 + tránh webview cũ thiếu API
        this.vehicles = ([] as VehicleAgent[]).concat(...this.queues);
        this.vehicles.forEach((v, i) => { v.uid = i; });
        this.stops = this.network.stops.filter(s => s.index < this.level.stops.length);
        this.stopQueues = this.level.stops.map((s, si) =>
            s.passengers.map(c => new PassengerAgent(c, si)));
        this.passengers = ([] as PassengerAgent[]).concat(...this.stopQueues);
        this.parking = new Array(Math.min(this.level.parkingSlots, this.network.parkingSlotCount())).fill(null);
        this.stopBusy = new Array(this.level.stops.length).fill(0);

        this.roadCount = 0;
        this.outCount = 0;
        this.elapsed = 0;
        this.eventLog = [];
        this.state = GameState.Playing;

        for (const v of this.vehicles) this.syncVehiclePose(v);
        this.stopQueues.forEach((_, si) => this.layoutStopQueue(si, true));
    }

    // ---------------- Input ----------------

    /**
     * Tap xe ĐẦU hàng chờ cho lên đường (input chính của game).
     * Xe được nhận path xuất phát từ đầu hàng → entry; các xe sau chỉ bị đổi
     * `queueSlot` đích và tự CHẠY dồn lên trong tick (không teleport).
     *
     * @param qi Index hàng chờ.
     * @returns 'ok' nếu xe đã được phái đi; mã từ chối khác xem {@link TapResult}
     *   (đáng chú ý: 'not-ready' khi xe đầu hàng còn đang dồn lên — cách vị trí
     *   xuất phát quá 0.3m thì path dựng sẵn sẽ bị lệch nên chưa cho đi).
     */
    tapQueueHead(qi: number): TapResult {
        if (this.state !== GameState.Playing) return 'not-playing';
        const q = this.queues[qi];
        if (!q || q.length === 0) return 'empty';
        if (this.roadCount >= this.level.capacity) return 'capacity-full';
        // xe chưa dồn xong lên đầu hàng thì chưa tap được (path xuất phát từ đầu hàng)
        const headPos = this.network.queueSlotPos(qi, 0);
        const head = q[0];
        if (Math.hypot(headPos.x - head.pos.x, headPos.z - head.pos.z) > 0.3) return 'not-ready';

        const v = q.shift()!;
        // xe phía sau chỉ đổi slot đích — tickVehicle sẽ cho chúng CHẠY lên, không teleport
        for (const rest of q) rest.queueSlot--;
        this.roadCount++;
        v.queueSlot = -1;
        v.path = this.network.getFromQueue(qi);
        v.dist = 0;
        v.state = VehicleState.ToEntry;
        this.emit({ type: 'dispatch', vehicle: v });
        this.emit({ type: 'queue-shift', queueIndex: qi });
        return 'ok';
    }

    /**
     * Tap xe đang ĐẬU cho chạy tiếp một vòng đón nốt khách.
     * Chỉ nhận xe đã đậu hẳn (state Parked) — xe còn đang lăn bánh vào bãi
     * (ToParking) tap sẽ bị từ chối, tránh teleport xe về slot.
     *
     * @param slot Index chỗ đậu.
     * @returns 'ok' nếu xe đã được phái đi; mã từ chối khác xem {@link TapResult}.
     */
    tapParkedSlot(slot: number): TapResult {
        if (this.state !== GameState.Playing) return 'not-playing';
        const v = this.parking[slot];
        if (!v || v.state !== VehicleState.Parked) return 'not-parked';
        if (this.roadCount >= this.level.capacity) return 'capacity-full';

        this.parking[slot] = null;
        v.parkingSlot = -1;
        this.roadCount++;
        v.path = this.network.getFromParking(slot);
        v.dist = 0;
        v.state = VehicleState.ToEntry;
        this.emit({ type: 'dispatch', vehicle: v });
        return 'ok';
    }

    // ---------------- Tick ----------------

    protected update(dt: number): void {
        // clamp dt 100ms: tab bị nền/khựng máy không làm xe "tele" xuyên bến
        this.tick(Math.min(dt, 0.1));
    }

    /**
     * Bước mô phỏng trung tâm — gọi mỗi frame từ update(). Tách khỏi update()
     * để gọi thẳng được với dt cố định khi cần test (logic deterministic theo
     * dt, không phụ thuộc frame thật).
     *
     * @param dt Bước thời gian (giây).
     */
    tick(dt: number): void {
        if (this.state !== GameState.Playing) return;
        this.elapsed += dt;
        for (const v of this.vehicles) this.tickVehicle(v, dt);
        for (const p of this.passengers) this.tickPassenger(p, dt);
    }

    private tickVehicle(v: VehicleAgent, dt: number): void {
        switch (v.state) {
            case VehicleState.InQueue: {
                // dồn hàng: chạy lên slot đích thay vì teleport
                const target = this.network.queueSlotPos(v.queueIndex, v.queueSlot);
                const dx = target.x - v.pos.x;
                const dz = target.z - v.pos.z;
                const d = Math.hypot(dx, dz);
                if (d > 0.001 && !this.queueAdvanceBlocked(v, dx / d, dz / d)) {
                    const step = Math.min(d, CONFIG.vehicleSpeed * 0.8 * dt);
                    v.pos.x += (dx / d) * step;
                    v.pos.z += (dz / d) * step;
                    if (v.node) v.node.setWorldPosition(v.pos);
                }
                break;
            }
            case VehicleState.ToEntry: {
                // không chèn lên xe khác cũng đang trên đường ra entry
                if (this.blockedAheadInWorld(v)) break;
                v.dist += CONFIG.vehicleSpeed * dt;
                if (v.dist >= v.path!.totalLength) {
                    v.path = this.network.loop;
                    v.dist = 0;
                    v.nextStopIdx = 0;
                    v.state = VehicleState.OnLoop;
                }
                this.syncVehiclePose(v);
                break;
            }
            case VehicleState.OnLoop: {
                let nd = v.dist + CONFIG.vehicleSpeed * dt;
                // không vượt / không húc đuôi xe phía trước trên loop
                const aheadDist = this.aheadDistOnLoop(v);
                if (aheadDist !== null) nd = Math.min(nd, Math.max(v.dist, aheadDist - CONFIG.vehicleGap));
                // kiểm tra bến kế tiếp (kích hoạt sớm boardLeadDistance để khách lên khi xe vừa trờ tới)
                const stops = this.stops;
                if (v.nextStopIdx < stops.length) {
                    const stop = stops[v.nextStopIdx];
                    const trigger = stop.loopDistance - CONFIG.boardLeadDistance;
                    if (nd >= trigger) {
                        if (this.stopBusy[stop.index] > 0) {
                            // bến đang có xe khác đón → dừng chờ trước bến, chưa đánh giá
                            nd = Math.min(nd, trigger);
                        } else {
                            const sq = this.stopQueues[stop.index];
                            if (!v.isFull && sq.length > 0 && sq[0].color === v.color) {
                                v.dist = Math.max(v.dist, trigger);
                                v.boardTimer = CONFIG.boardInitialDelay;
                                v.state = VehicleState.Boarding;
                                this.stopBusy[stop.index]++;
                                this.syncVehiclePose(v);
                                break;
                            }
                            v.nextStopIdx++; // không đủ điều kiện đón → chạy tiếp
                        }
                    }
                }
                v.dist = nd;
                this.syncVehiclePose(v);
                if (v.dist >= this.network.loop.totalLength) this.onLoopEnd(v);
                break;
            }
            case VehicleState.Boarding: {
                // xe bò chậm trong lúc khách lên (game feel), không vượt quá cuối vòng
                let crawl = v.dist + CONFIG.vehicleSpeed * CONFIG.boardingSpeedFactor * dt;
                const aheadCrawl = this.aheadDistOnLoop(v);
                if (aheadCrawl !== null) crawl = Math.min(crawl, Math.max(v.dist, aheadCrawl - CONFIG.vehicleGap));
                v.dist = Math.min(crawl, this.network.loop.totalLength - 0.4);
                this.syncVehiclePose(v);
                v.boardTimer -= dt;
                if (v.boardTimer > 0) break;
                const stop = this.stops[v.nextStopIdx];
                const sq = this.stopQueues[stop.index];
                if (!v.isFull && sq.length > 0 && sq[0].color === v.color) {
                    const p = sq.shift()!;
                    v.seatsLeft--;
                    p.state = PassengerState.Walking;
                    p.walkFrom.set(p.pos);
                    p.walkTo.set(v.pos);
                    p.target = v;
                    p.walkT = 0;
                    this.layoutStopQueue(stop.index);
                    this.emit({ type: 'board-start', vehicle: v, passenger: p });
                    this.emit({ type: 'queue-shift', queueIndex: -1 });
                    v.boardTimer = CONFIG.boardInterval;
                    if (v.isFull) this.emit({ type: 'lid-close', vehicle: v });
                } else {
                    // hết khách hợp lệ (hoặc hết chỗ) → rời bến, trả bến cho xe sau
                    this.stopBusy[stop.index]--;
                    v.nextStopIdx++;
                    v.state = VehicleState.OnLoop;
                    this.emit({ type: 'depart-stop', vehicle: v });
                }
                break;
            }
            case VehicleState.ToExit: {
                v.dist += CONFIG.vehicleSpeed * dt;
                this.syncVehiclePose(v);
                if (v.dist >= v.path!.totalLength) {
                    v.state = VehicleState.Out;
                    this.roadCount--;
                    this.outCount++;
                    this.emit({ type: 'exited', vehicle: v });
                    if (this.outCount === this.vehicles.length) {
                        this.state = GameState.Won;
                        console.log(`[BusAway] WIN — ${this.elapsed.toFixed(1)}s, ${this.outCount}/${this.vehicles.length} xe đã đón đủ khách và ra ngoài`);
                        this.emit({ type: 'won' });
                    }
                }
                break;
            }
            case VehicleState.ToParking: {
                v.dist += CONFIG.vehicleSpeed * dt;
                this.syncVehiclePose(v);
                if (v.dist >= v.path!.totalLength) {
                    v.state = VehicleState.Parked;
                    this.roadCount--;
                    if (v.parkingSlot < 0) {
                        // xe đã về tới trước bãi nhưng không còn chỗ → THUA
                        this.state = GameState.Lost;
                        console.log(`[BusAway] LOSE — ${this.elapsed.toFixed(1)}s: xe ${GameColor[v.color]}${v.seatsTotal} `
                            + `(còn ${v.seatsLeft} ghế trống) về tới bãi nhưng cả ${this.parking.length} chỗ đậu đã kín. `
                            + `Đã ra ngoài ${this.outCount}/${this.vehicles.length} xe.`);
                        this.emit({ type: 'lost' });
                        break;
                    }
                    this.emit({ type: 'parked', vehicle: v });
                }
                break;
            }
            // InQueue / Parked / Out: đứng yên
        }
    }

    /**
     * Xe chạy hết vòng — điểm rẽ nhánh quyết định số phận:
     * - đầy khách → đường ra cổng (ToExit);
     * - chưa đầy, còn chỗ → chiếm chỗ đậu trống ĐẦU TIÊN, chạy về đó;
     * - chưa đầy, bãi kín → nhận đường "thua" (parkingSlot = -1), game chỉ
     *   tuyên THUA khi xe này về tới nơi (xử lý trong nhánh ToParking của tick).
     *
     * @param v Xe vừa chạm cuối loop.
     */
    private onLoopEnd(v: VehicleAgent): void {
        if (v.isFull) {
            v.path = this.network.exit;
            v.dist = 0;
            v.state = VehicleState.ToExit;
            this.emit({ type: 'exit-start', vehicle: v });
            return;
        }
        const slot = this.parking.indexOf(null);
        if (slot < 0) {
            // bãi kín: xe vẫn chạy về tới trước bãi, tới nơi mới tuyên THUA (xử lý ở ToParking)
            v.parkingSlot = -1;
            v.path = this.network.getLoseApproach();
            v.dist = 0;
            v.state = VehicleState.ToParking;
            return;
        }
        this.parking[slot] = v;
        v.parkingSlot = slot;
        v.path = this.network.getToParking(slot);
        v.dist = 0;
        v.state = VehicleState.ToParking;
    }

    private tickPassenger(p: PassengerAgent, dt: number): void {
        if (p.state === PassengerState.Waiting) {
            this.tickQueueShift(p, dt);
            return;
        }
        if (p.state !== PassengerState.Walking) return;
        if (p.target) p.walkTo.set(p.target.pos); // bám theo xe đang bò chậm
        p.walkT += dt / CONFIG.walkDuration;
        if (p.walkT >= 1) {
            p.walkT = 1;
            p.state = PassengerState.Gone;
            this.emit({ type: 'passenger-gone', passenger: p });
        }
        Vec3.lerp(p.pos, p.walkFrom, p.walkTo, p.walkT);
        // quay mặt theo hướng đi (bỏ qua khi đã sát đích để khỏi giật hướng)
        const dx = p.walkTo.x - p.pos.x;
        const dz = p.walkTo.z - p.pos.z;
        if (dx * dx + dz * dz > 0.0025) p.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        this.syncPassengerNode(p);
    }

    /**
     * Khách dồn hàng: ĐI BỘ tới `queueTarget` (không teleport). Phát
     * `passenger-step` lúc bắt đầu nhúc nhích (view chuyển clip Walk) và
     * `passenger-wait` khi tới slot (snap vị trí, quay mặt lại ra đường,
     * view chuyển về Idle).
     *
     * @param p Khách đang ở trạng thái Waiting.
     * @param dt Bước thời gian (giây).
     */
    private tickQueueShift(p: PassengerAgent, dt: number): void {
        const dx = p.queueTarget.x - p.pos.x;
        const dz = p.queueTarget.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.005) {
            if (p.shifting) {
                p.shifting = false;
                p.pos.set(p.queueTarget);
                p.yaw = p.idleYaw;
                this.syncPassengerNode(p);
                this.emit({ type: 'passenger-wait', passenger: p });
            }
            return;
        }
        if (!p.shifting) {
            p.shifting = true;
            this.emit({ type: 'passenger-step', passenger: p });
        }
        const step = Math.min(d, CONFIG.passengerShiftSpeed * dt);
        p.pos.x += (dx / d) * step;
        p.pos.z += (dz / d) * step;
        p.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        this.syncPassengerNode(p);
    }

    /**
     * Xe trong hàng chờ có bị chặn theo hướng dồn lên không. Hai nguồn chặn:
     * xe vừa tap còn đứng gần đầu hàng (ToEntry chưa đi hẳn) hoặc xe cùng hàng
     * phía trước chưa nhích đủ xa — tránh xe sau dồn lên ĐÈ vào đuôi xe trước.
     *
     * @param v Xe InQueue đang muốn nhích lên.
     * @param dirX,dirZ Hướng dồn (đơn vị) — chỉ xe nằm VỀ PHÍA hướng này mới tính là chặn.
     * @returns true nếu có xe chắn trong phạm vi vehicleGap → đứng yên frame này.
     */
    private queueAdvanceBlocked(v: VehicleAgent, dirX: number, dirZ: number): boolean {
        for (const o of this.vehicles) {
            if (o === v) continue;
            const isQueueMateAhead = o.state === VehicleState.InQueue
                && o.queueIndex === v.queueIndex && o.queueSlot < v.queueSlot;
            if (o.state !== VehicleState.ToEntry && !isQueueMateAhead) continue;
            const dx = o.pos.x - v.pos.x;
            const dz = o.pos.z - v.pos.z;
            if (dx * dirX + dz * dirZ <= 0) continue; // không nằm trên hướng dồn
            if (Math.hypot(dx, dz) < CONFIG.vehicleGap) return true;
        }
        return false;
    }

    /**
     * Xe đang chạy ra entry (ToEntry) có bị chặn phía trước không — kiểm tra
     * bằng KHOẢNG CÁCH WORLD vì các xe lúc này nằm trên path khác nhau, không
     * so được bằng dist. Nhường cả hai loại:
     * - xe ToEntry khác (2 xe cùng nhập làn): nếu chặn LẪN NHAU thì xe còn ít
     *   quãng đường hơn đi trước, hoà nữa thì so uid — tránh deadlock cả 2
     *   cùng đứng yên chờ nhau vĩnh viễn;
     * - xe đã ở trên vòng (OnLoop/Boarding) gần điểm nhập — vd xe đang đón
     *   khách ở bến sát entry, xe mới phải chờ chứ không lao vào đè lên.
     *
     * @param v Xe ToEntry đang muốn tiến.
     * @returns true nếu phải đứng yên frame này.
     */
    private blockedAheadInWorld(v: VehicleAgent): boolean {
        for (const o of this.vehicles) {
            if (o === v) continue;
            const onRoad = o.state === VehicleState.OnLoop || o.state === VehicleState.Boarding;
            if (o.state !== VehicleState.ToEntry && !onRoad) continue;
            const dx = o.pos.x - v.pos.x;
            const dz = o.pos.z - v.pos.z;
            if (dx * v.dir.x + dz * v.dir.z <= 0) continue; // không ở phía trước
            if (Math.hypot(dx, dz) >= CONFIG.vehicleGap) continue;
            if (o.state === VehicleState.ToEntry) {
                // xe kia cũng thấy mình trước mặt nó? → chặn lẫn nhau, cần tie-break
                const mutual = -dx * o.dir.x + -dz * o.dir.z > 0;
                if (mutual) {
                    const myRemain = v.path!.totalLength - v.dist;
                    const oRemain = o.path!.totalLength - o.dist;
                    if (myRemain < oRemain || (myRemain === oRemain && v.uid < o.uid)) continue; // mình đi trước
                }
            }
            return true;
        }
        return false;
    }

    /**
     * Quãng đường (dist trên loop) của xe GẦN NHẤT phía trước cùng trên loop.
     * Caller clamp bước tiến về `aheadDist - vehicleGap` để giữ khoảng cách
     * nối đuôi — cơ chế chống vượt/húc đuôi duy nhất trên loop (mọi xe trên
     * loop dùng chung một path nên so dist là đủ, rẻ hơn nhiều so với physics).
     *
     * @param v Xe đang xét (OnLoop hoặc Boarding).
     * @returns dist của xe phía trước, hoặc null nếu trước mặt trống.
     */
    private aheadDistOnLoop(v: VehicleAgent): number | null {
        let best: number | null = null;
        for (const o of this.vehicles) {
            if (o === v) continue;
            if (o.state !== VehicleState.OnLoop && o.state !== VehicleState.Boarding) continue;
            if (o.dist > v.dist && (best === null || o.dist < best)) best = o.dist;
        }
        return best;
    }

    // ---------------- Pose / view sync ----------------

    /**
     * Đồng bộ pos/dir logic của xe theo trạng thái, rồi áp vào node 3D nếu có.
     * Public vì GameView gọi một lần sau khi spawn node để đặt pose ban đầu.
     *
     * Model xe quay mặt theo +Z local nên yaw = atan2(dir.x, dir.z);
     * xe thua (parkingSlot = -1, state Parked) giữ nguyên vị trí cuối đường
     * thua thay vì snap vào slot.
     *
     * @param v Xe cần đồng bộ.
     */
    syncVehiclePose(v: VehicleAgent): void {
        switch (v.state) {
            case VehicleState.InQueue:
                v.pos.set(this.network.queueSlotPos(v.queueIndex, v.queueSlot));
                v.dir.set(this.network.queueFacing(v.queueIndex));
                break;
            case VehicleState.Parked:
                // xe thua (parkingSlot -1) đứng nguyên tại cuối đường về bãi
                if (v.parkingSlot >= 0) v.pos.set(this.network.parkingSlotPos(v.parkingSlot));
                break;
            default:
                if (v.path) v.path.sample(Math.min(v.dist, v.path.totalLength), v.pos, v.dir);
        }
        if (v.node) {
            v.node.setWorldPosition(v.pos);
            // model xe quay mặt về +Z local → yaw sao cho +Z trùng hướng chạy
            const yaw = Math.atan2(v.dir.x, v.dir.z) * 180 / Math.PI;
            v.node.setRotationFromEuler(0, yaw, 0);
        }
    }

    /**
     * Cập nhật SLOT của khách còn chờ ở bến — chỉ đặt `queueTarget` + `idleYaw`,
     * khách tự ĐI BỘ tới đó trong tickQueueShift (không teleport). Hàng xếp
     * từ queueAnchor dọc queueDir, dài quá queueRowSize thì xuống dòng theo rowDir.
     *
     * @param si Index bến (stop.index trong level).
     * @param instant true = đặt thẳng vị trí + hướng (chỉ dùng lúc startGame,
     *   khi khách chưa từng có vị trí cũ để đi bộ từ đó).
     */
    private layoutStopQueue(si: number, instant = false): void {
        const stop = this.stops.find(s => s.index === si)!;
        const sq = this.stopQueues[si];
        // đứng chờ quay mặt về phía đường (ngược hướng hàng kéo dài)
        const waitYaw = Math.atan2(-stop.queueDir.x, -stop.queueDir.z) * 180 / Math.PI;
        for (let i = 0; i < sq.length; i++) {
            const p = sq[i];
            if (p.state !== PassengerState.Waiting) continue;
            p.idleYaw = waitYaw;
            const col = i % CONFIG.queueRowSize;
            const row = Math.floor(i / CONFIG.queueRowSize);
            p.queueTarget.set(
                stop.queueAnchor.x + stop.queueDir.x * CONFIG.passengerSpacing * col + stop.rowDir.x * CONFIG.queueRowGap * row,
                stop.queueAnchor.y,
                stop.queueAnchor.z + stop.queueDir.z * CONFIG.passengerSpacing * col + stop.rowDir.z * CONFIG.queueRowGap * row,
            );
            if (instant) {
                p.pos.set(p.queueTarget);
                p.yaw = waitYaw;
                this.syncPassengerNode(p);
            }
        }
    }

    /** Áp pos/yaw logic của khách vào node stickman (no-op khi chạy test không view). */
    private syncPassengerNode(p: PassengerAgent): void {
        if (!p.node) return;
        p.node.setWorldPosition(p.pos);
        p.node.setRotationFromEuler(0, p.yaw, 0);
    }

    private emit(ev: GameEvent): void {
        // step/wait bắn mỗi lần cả hàng dồn lên — không ghi log để khỏi ngập eventLog
        if (ev.type !== 'passenger-step' && ev.type !== 'passenger-wait') {
            const detail = 'vehicle' in ev
                ? ` ${GameColor[(ev as { vehicle: VehicleAgent }).vehicle.color]}${(ev as { vehicle: VehicleAgent }).vehicle.seatsTotal}`
                : '';
            this.eventLog.push(`[${this.elapsed.toFixed(1)}s] ${ev.type}${detail}`);
        }
        this.onEvent?.(ev);
    }
}
