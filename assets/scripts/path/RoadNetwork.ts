import { Component, Vec3, _decorator } from 'cc';
import { Path } from './Path';
import {
    EXIT_POINTS, LOOP_POINTS, LOSE_POINTS, PARKING_SLOTS, QUEUE_LAYOUTS, STOP_LAYOUTS,
    parkingApproach, parkingToEntry, queueToEntry,
} from './RoadLayout';

const { ccclass } = _decorator;

export interface StopInfo {
    /** Index gốc trong STOP_LAYOUTS — khớp với index stops của LevelData. */
    index: number;
    /** Quãng đường trên loop (m) mà xe phải dừng lại để đón. */
    loopDistance: number;
    /** Chỗ khách đầu hàng đứng (world space). */
    queueAnchor: Vec3;
    /** Hướng đơn vị hàng khách kéo dài ra sau. */
    queueDir: Vec3;
    /** Hướng đơn vị xuống dòng khi hàng dài quá queueRowSize. */
    rowDir: Vec3;
}

@ccclass('RoadNetwork')
export class RoadNetwork extends Component {
    /** Vòng đường chính từ LOOP_ENTRY tới LOOP_EXIT (chiều kim đồng hồ). */
    loop: Path = null!;
    /** Đường rời map qua khe cổng Barrier (xe đã đầy khách). */
    exit: Path = null!;
    /** Các bến đã map vào loop, sort tăng dần theo loopDistance. */
    stops: StopInfo[] = [];

    private toParkingCache = new Map<number, Path>();
    private fromParkingCache = new Map<number, Path>();
    private fromQueueCache = new Map<number, Path>();
    private losePath: Path | null = null;

    protected onLoad(): void {
        this.rebuild();
    }

    /**
     * Build lại toàn bộ path từ RoadLayout hiện tại và xoá mọi cache.
     * Gọi lúc onLoad và mỗi lần GameManager.startGame (restart level) —
     * idempotent, an toàn gọi nhiều lần.
     */
    rebuild(): void {
        this.loop = new Path(LOOP_POINTS);
        this.exit = new Path(EXIT_POINTS);
        this.toParkingCache.clear();
        this.fromParkingCache.clear();
        this.fromQueueCache.clear();
        this.losePath = null;
        this.stops = STOP_LAYOUTS.map((s, i) => ({
            index: i,
            loopDistance: this.loop.closestDistanceTo(new Vec3(s.roadPoint[0], s.roadPoint[1], s.roadPoint[2])),
            queueAnchor: new Vec3(s.queueAnchor[0], s.queueAnchor[1], s.queueAnchor[2]),
            queueDir: new Vec3(s.queueDir[0], s.queueDir[1], s.queueDir[2]).normalize(),
            rowDir: new Vec3(s.rowDir[0], s.rowDir[1], s.rowDir[2]).normalize(),
        }));
        this.stops.sort((a, b) => a.loopDistance - b.loopDistance);
    }

    /** @returns Số chỗ đậu vật lý có trong layout (LevelData.parkingSlots bị min với số này). */
    parkingSlotCount(): number {
        return PARKING_SLOTS.length;
    }

    /**
     * @param slot Index chỗ đậu (0 = ngoài cùng phía đông).
     * @returns Vec3 MỚI tại tâm chỗ đậu (world space) — caller giữ thoải mái.
     */
    parkingSlotPos(slot: number): Vec3 {
        const p = PARKING_SLOTS[slot];
        return new Vec3(p[0], p[1], p[2]);
    }

    /** @returns Số hàng xe chờ trong layout. */
    queueCount(): number {
        return QUEUE_LAYOUTS.length;
    }

    /**
     * Vị trí đứng của xe trong hàng chờ.
     *
     * @param queueIndex Index hàng chờ.
     * @param index Vị trí trong hàng, 0 = đầu hàng (xe tap được).
     * @returns Vec3 MỚI tại tâm slot đó (world space).
     */
    queueSlotPos(queueIndex: number, index: number): Vec3 {
        const q = QUEUE_LAYOUTS[queueIndex];
        return new Vec3(
            q.headPos[0] + q.queueDir[0] * q.gap * index,
            q.headPos[1] + q.queueDir[1] * q.gap * index,
            q.headPos[2] + q.queueDir[2] * q.gap * index,
        );
    }

    /**
     * Hướng nhìn của xe khi đứng trong hàng chờ (ngược queueDir — nhìn về phía
     * trước hàng, tức hướng sẽ xuất phát).
     *
     * @param queueIndex Index hàng chờ.
     * @returns Vec3 MỚI, đã normalize.
     */
    queueFacing(queueIndex: number): Vec3 {
        const q = QUEUE_LAYOUTS[queueIndex];
        return new Vec3(-q.queueDir[0], -q.queueDir[1], -q.queueDir[2]).normalize();
    }

    /**
     * Đường từ cuối loop vào chỗ đậu `slot` (xe hết vòng mà chưa đầy khách).
     * Build lần đầu khi cần rồi cache — các lần sau trả về cùng instance.
     *
     * @param slot Index chỗ đậu hợp lệ trong PARKING_SLOTS.
     * @returns Path dùng chung (KHÔNG mutate; xe giữ dist riêng).
     */
    getToParking(slot: number): Path {
        let p = this.toParkingCache.get(slot);
        if (!p) {
            p = new Path(parkingApproach(slot));
            this.toParkingCache.set(slot, p);
        }
        return p;
    }

    /**
     * Đường từ chỗ đậu `slot` quay lại điểm vào vòng (xe đậu được tap chạy tiếp).
     *
     * @param slot Index chỗ đậu hợp lệ trong PARKING_SLOTS.
     * @returns Path dùng chung, cache theo slot.
     */
    getFromParking(slot: number): Path {
        let p = this.fromParkingCache.get(slot);
        if (!p) {
            p = new Path(parkingToEntry(slot));
            this.fromParkingCache.set(slot, p);
        }
        return p;
    }

    /**
     * Đường từ đầu hàng chờ `queueIndex` tới điểm vào vòng (xe đầu hàng được tap).
     *
     * @param queueIndex Index hàng chờ hợp lệ trong QUEUE_LAYOUTS.
     * @returns Path dùng chung, cache theo hàng.
     */
    getFromQueue(queueIndex: number): Path {
        let p = this.fromQueueCache.get(queueIndex);
        if (!p) {
            p = new Path(queueToEntry(queueIndex));
            this.fromQueueCache.set(queueIndex, p);
        }
        return p;
    }

    /**
     * Đường cho xe hết vòng khi bãi ĐÃ KÍN: về dừng chính giữa trước hàng chỗ
     * đậu, mặt quay vào bãi. Game chỉ tuyên THUA khi xe
     * này chạy tới cuối đường — không tuyên ngay lúc rời loop.
     *
     * @returns Path dùng chung (build từ LOSE_POINTS, cache 1 instance).
     */
    getLoseApproach(): Path {
        if (!this.losePath) this.losePath = new Path(LOSE_POINTS);
        return this.losePath;
    }
}