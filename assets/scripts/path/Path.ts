import { Vec3 } from 'cc';

export class Path {
    /** Polyline đã resample (dày hơn control points `samplesPerSegment` lần). */
    private points: Vec3[] = [];
    /** cumLengths[i] = chiều dài tích luỹ từ points[0] tới points[i] (mét). */
    private cumLengths: number[] = [];
    /** Tổng chiều dài path (mét) — xe so `dist >= totalLength` để biết đi hết đường. */
    totalLength = 0;

    /**
     * Build path từ dãy điểm điều khiển.
     *
     * @param controlPoints Các điểm điều khiển `[x, y, z]` (world space, mét).
     *   Cần >= 2 điểm; nếu đúng 2 điểm thì giữ nguyên đoạn thẳng, không spline.
     * @param samplesPerSegment Số điểm resample giữa 2 control point liên tiếp.
     *   Càng cao khúc cua càng mượt nhưng tốn bộ nhớ tuyến tính; 8 là đủ cho
     *   scale đường ~30m của map này.
     * @throws Error nếu có ít hơn 2 điểm điều khiển.
     */
    constructor(controlPoints: [number, number, number][], samplesPerSegment = 8) {
        const ctrl = controlPoints.map(p => new Vec3(p[0], p[1], p[2]));
        if (ctrl.length < 2) throw new Error('Path cần ít nhất 2 điểm');
        this.points = ctrl.length === 2 ? ctrl : catmullRomResample(ctrl, samplesPerSegment);
        this.cumLengths = [0];
        for (let i = 1; i < this.points.length; i++) {
            this.totalLength += Vec3.distance(this.points[i - 1], this.points[i]);
            this.cumLengths.push(this.totalLength);
        }
    }

    /**
     * Lấy vị trí và hướng tại quãng đường `d` tính từ đầu path.
     *
     * Ghi kết quả vào tham số out (không cấp phát Vec3 mới — hàm này chạy
     * mỗi frame cho mọi xe nên tránh tạo rác cho GC).
     *
     * @param d Quãng đường đã đi (mét), tự clamp về [0, totalLength] —
     *   d âm trả về điểm đầu, d vượt cuối trả về điểm cuối.
     * @param outPos [out] Vị trí world space tại d.
     * @param outDir [out] Tangent đã normalize (hướng xe nhìn) tại d.
     */
    sample(d: number, outPos: Vec3, outDir: Vec3): void {
        const pts = this.points;
        if (d <= 0) {
            outPos.set(pts[0]);
            Vec3.subtract(outDir, pts[1], pts[0]).normalize();
            return;
        }
        if (d >= this.totalLength) {
            const n = pts.length;
            outPos.set(pts[n - 1]);
            Vec3.subtract(outDir, pts[n - 1], pts[n - 2]).normalize();
            return;
        }
        // binary search đoạn chứa d
        let lo = 0, hi = this.cumLengths.length - 1;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (this.cumLengths[mid] <= d) lo = mid; else hi = mid;
        }
        const segLen = this.cumLengths[hi] - this.cumLengths[lo];
        const t = segLen > 1e-6 ? (d - this.cumLengths[lo]) / segLen : 0;
        Vec3.lerp(outPos, pts[lo], pts[hi], t);
        Vec3.subtract(outDir, pts[hi], pts[lo]).normalize();
    }

    /**
     * Tìm quãng đường trên path mà điểm path tại đó GẦN điểm `p` nhất
     * (chiếu vuông góc `p` lên từng đoạn của polyline rồi lấy đoạn tốt nhất).
     *
     * Dùng một lần lúc build RoadNetwork để map toạ độ bến xe (đặt tay trong
     * RoadLayout) thành `loopDistance` — mốc trên loop mà xe phải dừng đón.
     *
     * @param p Điểm world space cần chiếu lên path.
     * @returns Quãng đường (mét, thuộc [0, totalLength]) tại hình chiếu gần nhất.
     */
    closestDistanceTo(p: Vec3): number {
        let best = 0, bestSq = Infinity;
        const tmp = new Vec3();
        for (let i = 1; i < this.points.length; i++) {
            const a = this.points[i - 1], b = this.points[i];
            Vec3.subtract(tmp, b, a);
            const segLenSq = tmp.lengthSqr();
            let t = 0;
            if (segLenSq > 1e-8) {
                t = Math.max(0, Math.min(1, ((p.x - a.x) * tmp.x + (p.y - a.y) * tmp.y + (p.z - a.z) * tmp.z) / segLenSq));
            }
            tmp.set(a.x + tmp.x * t, a.y + tmp.y * t, a.z + tmp.z * t);
            const dSq = Vec3.squaredDistance(p, tmp);
            if (dSq < bestSq) {
                bestSq = dSq;
                best = this.cumLengths[i - 1] + Math.sqrt(segLenSq) * t;
            }
        }
        return best;
    }
}

/**
 * Resample dãy control point thành polyline mượt bằng Catmull-Rom.
 * Spline đi QUA mọi control point; điểm đầu/cuối được giữ nguyên (đoạn biên
 * dùng chính điểm biên làm điểm lân cận ảo).
 *
 * @param ctrl Dãy control point (>= 3 điểm — 2 điểm thì caller giữ đoạn thẳng).
 * @param samplesPerSegment Số điểm sinh ra giữa 2 control point liên tiếp.
 * @returns Polyline mới, độ dài ≈ (ctrl.length - 1) * samplesPerSegment + 1.
 */
function catmullRomResample(ctrl: Vec3[], samplesPerSegment: number): Vec3[] {
    const out: Vec3[] = [];
    const n = ctrl.length;
    for (let i = 0; i < n - 1; i++) {
        const p0 = ctrl[Math.max(0, i - 1)];
        const p1 = ctrl[i];
        const p2 = ctrl[i + 1];
        const p3 = ctrl[Math.min(n - 1, i + 2)];
        for (let s = 0; s < samplesPerSegment; s++) {
            const t = s / samplesPerSegment;
            out.push(catmullRom(p0, p1, p2, p3, t));
        }
    }
    out.push(ctrl[n - 1].clone());
    return out;
}

/**
 * Nội suy Catmull-Rom chuẩn (tension 0.5) trên đoạn p1→p2.
 *
 * @param p0 Điểm trước đoạn (định hình tangent vào).
 * @param p1 Điểm đầu đoạn (t=0 trả về đúng p1).
 * @param p2 Điểm cuối đoạn (t=1 trả về đúng p2).
 * @param p3 Điểm sau đoạn (định hình tangent ra).
 * @param t Tham số nội suy [0, 1].
 * @returns Vec3 mới tại vị trí nội suy.
 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
    const t2 = t * t, t3 = t2 * t;
    const f = (a: number, b: number, c: number, d: number) =>
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return new Vec3(
        f(p0.x, p1.x, p2.x, p3.x),
        f(p0.y, p1.y, p2.y, p3.y),
        f(p0.z, p1.z, p2.z, p3.z),
    );
}
