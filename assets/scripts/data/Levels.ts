import { BusStopData, COLOR_NAMES, GameColor, LevelData, QueueData } from './GameTypes';

const { Red: R, Blue: B, Yellow: Y, Green: G } = GameColor;

/**
 * Level 1 — thiết kế cho thời lượng 30-60 giây, độ khó CÓ CỬA THUA.
 *
 * 10 xe / 46 ghế = 46 khách, capacity 4, 4 chỗ đậu.
 * Phân hoạch màu theo hàng (HÀNG 1 chỉ R/B đón ở BẾN 1, HÀNG 2 chỉ Y/G đón ở
 * BẾN 2) để xe hàng này không trộm khách bến kia. Độ xáo trộn khách:
 * - Xe ĐẦU hàng (R4/Y4) ra sớm trượt bến → phải GỬI BÃI để mở khoá xe sau.
 * - Bến 1 xáo mạnh (B×6 chặn đầu, cụm R×2/B×2 xen kẽ): tap ẩu cả hàng 1 trượt
 *   tới 4 xe (R4 trống, R6 trống, B4 dở 2/4, R4 dở 2/4) — xe dở phải về bãi
 *   rồi gọi lại LẦN NỮA mới đầy.
 * - Bến 2 xáo nhẹ hơn (Y×2 kẹp giữa khối G): thêm 2 xe có thể trượt (Y4, Y6).
 * Tổng số xe có thể trượt cùng lúc = 6 > 4 chỗ đậu → tap ẩu là kín bãi,
 * xe kế hết vòng không còn chỗ → THUA (người chơi biết tính vẫn thắng được
 * trong ~40s với 16 lượt tap).
 */
export const LEVEL_1: LevelData = {
    capacity: 4,
    parkingSlots: 4,
    queues: [
        { vehicles: [{ color: R, seats: 4 }, { color: B, seats: 4 }, { color: R, seats: 6 }, { color: B, seats: 4 }, { color: R, seats: 4 }] },
        { vehicles: [{ color: Y, seats: 4 }, { color: G, seats: 4 }, { color: Y, seats: 6 }, { color: G, seats: 6 }, { color: Y, seats: 4 }] },
    ],
    stops: [
        { passengers: [B, B, B, B, B, B, R, R, B, B, R, R, R, R, R, R, R, R, R, R, R, R] },
        { passengers: [G, G, G, G, Y, Y, G, G, G, G, G, G, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y, Y] },
    ],
};

