export type P3 = [number, number, number];

/** Độ cao xe chạy trên mặt đường. */
export const DRIVE_Y = 0.05;

const ROAD_DX = 0.14;
const ROAD_DZ = -1.65;

const onRoad = (p: P3): P3 => [p[0] + ROAD_DX, p[1], p[2] + ROAD_DZ];

/** Điểm vào vòng (đáy đường trái) và điểm ra (đáy đường phải). */
// export const LOOP_ENTRY: P3 = onRoad([-4.5, DRIVE_Y, -1.0]);
export const LOOP_ENTRY: P3 = onRoad([-4.3, DRIVE_Y, -1.0]);
export const LOOP_EXIT: P3 = onRoad([4.3, DRIVE_Y, -1.0]);

/** Centerline vòng đường, từ entry tới exit (chiều kim đồng hồ), toạ độ đo gốc. */
const RAW_LOOP_POINTS: P3[] = [
    [-4.5, DRIVE_Y, -1.0],
    [-4.45, DRIVE_Y, 1.0],
    [-4.43, DRIVE_Y, 2.0],
    // chéo NE vào giữa (centerline đo từ cặp mép trong/ngoài của mesh)
    [-3.85, DRIVE_Y, 3.0],
    [-3.17, DRIVE_Y, 4.0],
    [-2.55, DRIVE_Y, 5.0],
    [-2.28, DRIVE_Y, 5.7],
    [-2.22, DRIVE_Y, 6.4],
    // cong chữ S đi lên
    [-2.4, DRIVE_Y, 7.0],
    [-2.75, DRIVE_Y, 8.0],
    [-3.1, DRIVE_Y, 9.0],
    [-3.3, DRIVE_Y, 10.0],
    [-3.05, DRIVE_Y, 11.0],
    [-2.55, DRIVE_Y, 11.9],
    [-1.9, DRIVE_Y, 12.5],
    // ngang đỉnh
    [-1.0, DRIVE_Y, 12.9],
    [0.0, DRIVE_Y, 12.95],
    [1.0, DRIVE_Y, 12.8],
    [1.9, DRIVE_Y, 12.3],
    // vòng xuống đường phải
    [2.5, DRIVE_Y, 11.8],
    [2.95, DRIVE_Y, 11.0],
    [3.34, DRIVE_Y, 10.0],
    [3.65, DRIVE_Y, 9.0],
    [3.84, DRIVE_Y, 8.0],
    [4.0, DRIVE_Y, 7.0],
    [4.1, DRIVE_Y, 6.0],
    [4.2, DRIVE_Y, 5.0],
    [4.28, DRIVE_Y, 4.0],
    [4.34, DRIVE_Y, 3.0],
    [4.35, DRIVE_Y, 2.0],
    [4.36, DRIVE_Y, 1.0],
    [4.35, DRIVE_Y, 0.0],
    [4.3, DRIVE_Y, -1.0],
];

export const LOOP_POINTS: P3[] = RAW_LOOP_POINTS.map(onRoad);

/**
 * Bến xe: roadPoint là điểm dừng trên đường (sẽ map vào quãng đường trên loop),
 * queueAnchor là chỗ khách ĐẦU hàng đứng, queueDir là hướng hàng khách kéo dài ra sau.
 */
export interface StopLayout {
    /** Điểm dừng đón trên mặt đường — được chiếu lên loop thành loopDistance. */
    roadPoint: P3;
    /** Vị trí khách ĐẦU hàng đứng (mép ngoài đường, cạnh roadPoint). */
    queueAnchor: P3;
    /** Hướng (đơn vị) hàng khách kéo dài ra sau tính từ queueAnchor. */
    queueDir: P3;
    /** Hướng xuống dòng khi hàng khách dài quá queueRowSize (xếp nhiều hàng). */
    rowDir: P3;
}

export const STOP_LAYOUTS: StopLayout[] = [
    // Bến 1: khúc cua TRÊN-TRÁI, khách đứng MÉP NGOÀI đường, 1 đường chéo
    // hướng lên góc trên-trái map (như dòng người từ chân trời đi xuống bến)
    { roadPoint: onRoad([-1.9, DRIVE_Y, 12.5]), queueAnchor: onRoad([-2.5, DRIVE_Y, 13.8]), queueDir: [-0.75, 0, 0.66], rowDir: [0, 0, 1] },
    // Bến 2: khúc cua TRÊN-PHẢI, khách ở mép ngoài, đường chéo hướng lên góc trên-phải
    { roadPoint: onRoad([2.5, DRIVE_Y, 11.8]), queueAnchor: onRoad([3.2, DRIVE_Y, 13.2]), queueDir: [0.75, 0, 0.66], rowDir: [0, 0, 1] },
];

/**
 * Đường ra cổng (xe đầy khách): từ cuối loop rẽ đông-nam, chui qua KHE cổng
 * (thanh chắn khi đóng vươn về bắc từ trụ (6.91,-6.82), chắn dải z -6.8..-4.5
 * tại x=6.91 → xe cắt qua giữa khe ở z=-5.6, không đâm vào trụ), rồi qua
 * Tunnel và ra khỏi map.
 */
export const EXIT_POINTS: P3[] = [
    // cung cong đều: xuống nam rồi ngoặt trái ra đông ở z=-5, độ cong một chiều
    // (điểm cách đều, không đổi chiều cong → Catmull-Rom không bị zic-zac)
    LOOP_EXIT,
    [4.55, DRIVE_Y, -3.6],
    [5.0, DRIVE_Y, -4.5],
    [5.9, DRIVE_Y, -4.95],
    [7.5, DRIVE_Y, -5.0], // qua khe thanh chắn (x=6.91) rồi ra ngoài
];

/**
 * Đường cho xe hết vòng khi bãi ĐÃ KÍN: cong đều về giữa bãi, đoạn cuối hướng
 * nam để xe dừng quay mặt vào hàng xe đậu, cách mũi xe đậu (~-7.7) một khoảng
 * an toàn — không đè lên xe trong slot.
 */
export const LOSE_POINTS: P3[] = [
    LOOP_EXIT,
    [4.4, DRIVE_Y, -4.0],
    [3.0, DRIVE_Y, -4.7],
    [1.5, DRIVE_Y, -5.1],
    [0.3, DRIVE_Y, -5.6],
    [-0.3, DRIVE_Y, -6.3],
];

/** Vị trí 4 chỗ đậu (khớp các node Parking trong scene), thứ tự từ đông sang tây. */
export const PARKING_SLOTS: P3[] = [
    [2.84, DRIVE_Y, -8.93],
    [0.75, DRIVE_Y, -8.93],
    [-1.34, DRIVE_Y, -8.93],
    [-3.41, DRIVE_Y, -8.93],
];

/**
 * Sinh control points cho đường từ cuối loop vào chỗ đậu.
 *
 * Hình dạng: từ LOOP_EXIT vòng xuống nam (men theo mép đông), chạy ngang
 * hành lang z≈-6.8 tới trước slot rồi lùi thẳng vào slot (đoạn cuối hướng nam
 * để xe đậu quay mặt ra đường, đúng chiều xuất phát khi được gọi lại).
 *
 * @param slot Index chỗ đậu trong {@link PARKING_SLOTS} (0 = ngoài cùng phía đông).
 * @returns Dãy control point cho `new Path(...)` — RoadNetwork cache theo slot.
 */
export function parkingApproach(slot: number): P3[] {
    const target = PARKING_SLOTS[slot];
    return [
        LOOP_EXIT,
        [4.35, DRIVE_Y, -4.0],
        [4.0, DRIVE_Y, -5.6],
        [target[0] + 1.2, DRIVE_Y, -6.8],
        [target[0], DRIVE_Y, -7.8],
        target,
    ];
}

/**
 * Hành lang đi chung ở z=-11.2: nằm giữa đuôi xe đậu (mũi xe đậu ~-10.1)
 * và mũi xe đầu hàng chờ (~-12.0) để xe chạy ngang không đè lên xe đứng yên.
 */
const CORRIDOR_Z = -11.2;

/**
 * Sinh control points cho đường từ chỗ đậu quay lại điểm vào vòng (khi xe đậu
 * được tap gọi chạy tiếp): lùi xuống hành lang chung → chạy về tây →
 * ngược lên bắc → nhập làn tại LOOP_ENTRY.
 *
 * @param slot Index chỗ đậu trong {@link PARKING_SLOTS}.
 * @returns Dãy control point cho `new Path(...)` — RoadNetwork cache theo slot.
 */
export function parkingToEntry(slot: number): P3[] {
    const from = PARKING_SLOTS[slot];
    return [
        from,
        [from[0] - 0.8, DRIVE_Y, CORRIDOR_Z],
        [-5.2, DRIVE_Y, CORRIDOR_Z],
        [-5.7, DRIVE_Y, -7.0],
        [-5.2, DRIVE_Y, -4.2],
        LOOP_ENTRY,
    ];
}

/**
 * Vị trí các hàng xe chờ trong khu đất phía nam: hàng i bắt đầu tại headPos,
 * xe xếp nối đuôi theo queueDir (về phía sau).
 */
export interface QueueLayout {
    /** Vị trí xe ĐẦU hàng (xe duy nhất tap được). */
    headPos: P3;
    /** Hướng (đơn vị) từ xe đầu ra sau hàng — xe thứ i đứng tại headPos + queueDir*gap*i. */
    queueDir: P3;
    /** Khoảng cách tâm-tâm giữa 2 xe liên tiếp trong hàng (m). */
    gap: number;
}

export const QUEUE_LAYOUTS: QueueLayout[] = [
    // gap 2.3 để hàng 4 xe (đuôi ~-20.1) vẫn nằm gọn trong bãi đất (mép -21.25)
    { headPos: [-1.5, DRIVE_Y, -13.2], queueDir: [0, 0, -1], gap: 2.3 },
    { headPos: [1.5, DRIVE_Y, -13.2], queueDir: [0, 0, -1], gap: 2.3 },
];

/**
 * Sinh control points cho đường từ ĐẦU hàng chờ tới điểm vào vòng (khi người
 * chơi tap xe đầu hàng): rẽ xuống hành lang chung → tây → bắc → LOOP_ENTRY.
 * Đi cùng hành lang với {@link parkingToEntry} nên hai luồng xe dùng chung
 * logic tránh nhau (blockedAheadInWorld) của GameManager.
 *
 * @param queueIndex Index hàng chờ trong {@link QUEUE_LAYOUTS} (0 = hàng trái).
 * @returns Dãy control point cho `new Path(...)` — RoadNetwork cache theo hàng.
 */
export function queueToEntry(queueIndex: number): P3[] {
    const head = QUEUE_LAYOUTS[queueIndex].headPos;
    return [
        head,
        [head[0] - 1.2, DRIVE_Y, CORRIDOR_Z],
        [-5.2, DRIVE_Y, CORRIDOR_Z],
        [-5.7, DRIVE_Y, -7.0],
        [-5.2, DRIVE_Y, -4.2],
        LOOP_ENTRY,
    ];
}
