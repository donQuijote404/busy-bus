/**
 * Màu của xe và hành khách — luật ghép màu cốt lõi của game:
 * khách chỉ lên được xe CÙNG MÀU đang dừng ở bến.
 * Giá trị số để serialize gọn trong level data.
 */
export enum GameColor {
    Red = 0,
    Blue = 1,
    Yellow = 2,
    Green = 3,
}

/** Số chỗ ngồi hợp lệ của một xe, khớp với 3 mesh Vehicle_04 / 06 / 10. */
export type SeatCount = 4 | 6 | 10;

/**
 * Bảng màu render RGB (0-255) cho từng GameColor.
 */
export const COLOR_PALETTE: Record<GameColor, [number, number, number]> = {
    [GameColor.Red]: [230, 60, 60],
    [GameColor.Blue]: [50, 110, 230],
    [GameColor.Yellow]: [240, 200, 40],
    [GameColor.Green]: [60, 190, 90],
};

/** Tên hiển thị/log cho từng GameColor (log WIN/LOSE, mô tả lời giải...). */
export const COLOR_NAMES: Record<GameColor, string> = {
    [GameColor.Red]: 'Red',
    [GameColor.Blue]: 'Blue',
    [GameColor.Yellow]: 'Yellow',
    [GameColor.Green]: 'Green',
};

/** Một xe trong hàng chờ (định nghĩa tĩnh trong level data). */
export interface VehicleData {
    /** Màu xe — quyết định khách nào được lên. */
    color: GameColor;
    /** Số ghế — quyết định mesh hiển thị (Vehicle_04/06/10) và lúc nào xe "đầy". */
    seats: SeatCount;
}

/** Một hàng xe chờ: index 0 là xe ĐẦU hàng (xe duy nhất tap được). */
export interface QueueData {
    vehicles: VehicleData[];
}

/** Một bến xe: index 0 là hành khách ĐẦU hàng (người duy nhất được xét lên xe). */
export interface BusStopData {
    passengers: GameColor[];
}

export interface LevelData {
    /** Số xe tối đa được phép chạy trên đường cùng lúc (đếm cả xe đang ra entry / về bãi). */
    capacity: number;
    /**
     * Số chỗ đậu cho xe đi hết vòng mà chưa đầy khách.
     * Runtime bị min với số chỗ vật lý trong RoadLayout.PARKING_SLOTS.
     * Đây cũng là điều kiện THUA: xe chưa đầy hết vòng mà bãi đã kín.
     */
    parkingSlots: number;
    /** Các hàng xe chờ, index khớp với RoadLayout.QUEUE_LAYOUTS. */
    queues: QueueData[];
    /**
     * Các bến xe theo thứ tự xe GẶP khi chạy chiều kim đồng hồ trên loop,
     * index khớp với RoadLayout.STOP_LAYOUTS.
     */
    stops: BusStopData[];
}
