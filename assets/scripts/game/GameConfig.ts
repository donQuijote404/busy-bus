export const CONFIG = {
    /** m/s — tốc độ xe. Loop 32.65m → ~8s một vòng. */
    vehicleSpeed: 8.0,
    /** hệ số tốc độ khi xe đang đón khách (bò chậm thay vì dừng hẳn) */
    boardingSpeedFactor: 0.25,
    /** giây giữa 2 khách lên xe liên tiếp */
    boardInterval: 0.35,
    /** giây trễ khi xe vừa dừng bến trước khi khách đầu tiên bước lên */
    boardInitialDelay: 0.05,
    /** xe bắt đầu đón khi còn cách điểm bến chừng này (m) — khách lên sớm khi xe vừa trờ tới */
    boardLeadDistance: 1.4,
    /** khoảng cách tối thiểu giữa 2 xe nối đuôi trên đường (m) */
    vehicleGap: 2.2,
    /** khoảng cách giữa 2 khách đứng xếp hàng (m) */
    passengerSpacing: 0.55,
    /** số khách tối đa một hàng ở bến (99 = một đường duy nhất, không xuống dòng) */
    queueRowSize: 99,
    /** khoảng cách giữa 2 hàng ngang khách (m) */
    queueRowGap: 0.7,
    /** thời gian khách đi bộ từ hàng lên xe (giây) */
    walkDuration: 0.35,
    /** m/s — tốc độ khách đi bộ dồn hàng (0.55m một nấc ≈ kịp nhịp boardInterval) */
    passengerShiftSpeed: 2.2,
};
