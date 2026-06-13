import {
    Camera, Color, Component, EventTouch, Input, Material, MeshRenderer, Node, SkeletalAnimation,
    Tween, Vec3, _decorator, director, input, instantiate, tween,
} from 'cc';
import { COLOR_PALETTE, GameColor } from '../data/GameTypes';
import { VehicleAgent } from './Agents';
import { GameManager, GameState } from './GameManager';

const { ccclass, property } = _decorator;

@ccclass('GameView')
export class GameView extends Component {
    /** Material thân xe (clone + đổi mainColor theo GameColor). */
    @property(Material) vehicleMat: Material = null!;
    /** Material thân stickman (clone + đổi mainColor theo GameColor). */
    @property(Material) stickmanMat: Material = null!;
    /** Material lốp xe (node tên Wheel*) — dùng chung, không đổi màu. */
    @property(Material) tireMat: Material = null!;
    /** Material bóng giả (node tên *_S) — dùng chung, không đổi màu. */
    @property(Material) shadowMat: Material = null!;

    private manager: GameManager = null!;
    private camera: Camera = null!;
    /** Node Templates trong scene — chỉ để clone, bị ẩn lúc start(). */
    private templates: Node = null!;
    /** Cha của mọi node xe — destroy cả cụm khi restart. */
    private vehicleRoot: Node | null = null;
    /** Cha của mọi node khách — destroy cả cụm khi restart. */
    private passengerRoot: Node | null = null;
    /** Material share theo (effect, màu) — N màu = N material, không clone per-object. */
    private materialCache = new Map<string, Material>();
    /** Thanh chắn ở cổng ra: euler x=-180 đóng, x=-90 mở. */
    private barrier: Node | null = null;
    /** Số xe đang trong đoạn exit — barrier mở khi >0, đóng khi về 0. */
    private exitingCount = 0;

    protected start(): void {
        this.manager = this.getComponent(GameManager)!;
        const scene = director.getScene()!;
        this.templates = scene.getChildByName('Templates')!;
        this.templates.active = false; // template chỉ để clone, không hiển thị
        this.camera = scene.getChildByName('Main Camera')!.getComponent(Camera)!;
        this.barrier = findChildByName(scene.getChildByName('Barrier'), 'Barrier_Open');
        input.on(Input.EventType.TOUCH_START, this.onTouch, this);
        this.restart();
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouch, this);
    }

    /**
     * Bắt đầu / chơi lại level: huỷ toàn bộ node cũ, gọi manager.startGame()
     * rồi dựng lại view từ state mới — đăng ký onEvent TRƯỚC startGame để
     * không lỡ sự kiện nào. Đây là entry point cho nút Restart (Task UI/UX).
     */
    restart(): void {
        this.vehicleRoot?.destroy();
        this.passengerRoot?.destroy();
        this.vehicleRoot = new Node('Vehicles');
        this.passengerRoot = new Node('Passengers');
        this.node.addChild(this.vehicleRoot);
        this.node.addChild(this.passengerRoot);

        this.exitingCount = 0;
        this.setBarrier(false, true);
        this.manager.onEvent = ev => {
            switch (ev.type) {
                case 'board-start':
                    if (ev.vehicle.node) this.scalePunch(ev.vehicle.node);
                    if (ev.passenger.node) this.playStickman(ev.passenger.node, 'Walk');
                    break;
                case 'exit-start':
                    if (++this.exitingCount === 1) this.setBarrier(true);
                    break;
                case 'exited':
                    if (ev.vehicle.node) ev.vehicle.node.active = false;
                    if (this.exitingCount > 0 && --this.exitingCount === 0) this.setBarrier(false);
                    break;
                case 'passenger-step':
                    if (ev.passenger.node) this.playStickman(ev.passenger.node, 'Walk');
                    break;
                case 'passenger-wait':
                    if (ev.passenger.node) this.playStickman(ev.passenger.node, 'Idle', true);
                    break;
                case 'passenger-gone':
                    if (ev.passenger.node) ev.passenger.node.active = false;
                    break;
            }
        };
        this.manager.startGame();

        for (const v of this.manager.vehicles) {
            // không dùng padStart (ES2017) — target ES2015: 4/6 → "04"/"06", 10 → "10"
            const tplName = `Vehicle_${v.seatsTotal < 10 ? '0' : ''}${v.seatsTotal}`;
            v.node = this.spawn(tplName, v.color, this.vehicleRoot);
            this.manager.syncVehiclePose(v);
        }
        for (const p of this.manager.passengers) {
            p.node = this.spawn('Stickman', p.color, this.passengerRoot);
            p.node.setWorldPosition(p.pos);
            p.node.setRotationFromEuler(0, p.yaw, 0);
            this.playStickman(p.node, 'Idle', true);
        }
    }

    private playStickman(node: Node, clip: 'Idle' | 'Walk', randomPhase = false): void {
        const anim = node.getComponent(SkeletalAnimation);
        if (!anim) return;
        anim.play(clip);
        if (randomPhase) {
            const st = anim.getState(clip);
            if (st) st.time = Math.random() * st.duration;
        }
    }

    /**
     * Mở/đóng thanh chắn cổng ra.
     *
     * @param open true = mở (euler x -90, easing backOut cho cảm giác bật lên),
     *   false = đóng (euler x -180, quadIn rơi xuống).
     * @param instant true = set thẳng không tween (lúc khởi tạo/restart).
     */
    private setBarrier(open: boolean, instant = false): void {
        if (!this.barrier) return;
        const e = this.barrier.eulerAngles;
        const targetX = open ? -90 : -180;
        Tween.stopAllByTarget(this.barrier);
        if (instant) {
            this.barrier.setRotationFromEuler(targetX, e.y, e.z);
            return;
        }
        tween(this.barrier)
            .to(0.3, { eulerAngles: new Vec3(targetX, e.y, e.z) }, { easing: open ? 'backOut' : 'quadIn' })
            .start();
    }

    /**
     * Nhún xe khi có khách lên (game feel): scale 1.12 trong 70ms rồi về 1
     * trong 120ms — đủ ngắn để khách lên dồn dập (0.35s/người) không chồng tween lỗi.
     *
     * @param node Node xe cần scale.
     */
    private scalePunch(node: Node): void {
        tween(node)
            .to(0.07, { scale: new Vec3(1.12, 1.12, 1.12) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    /**
     * Clone một template trong scene và gán material theo QUY ƯỚC TÊN node con:
     *
     * @param tplName Tên node template: `Vehicle_04` / `Vehicle_06` / `Vehicle_10` / `Stickman`.
     * @param color Màu gameplay → material thân tương ứng từ cache.
     * @param parent Node cha chứa instance mới (vehicleRoot / passengerRoot).
     * @returns Node vừa clone, đã active và gán material xong.
     */
    private spawn(tplName: string, color: GameColor, parent: Node): Node {
        const tpl = this.templates.getChildByName(tplName)!;
        const node = instantiate(tpl);
        node.active = true;
        parent.addChild(node);
        const isStickman = tplName === 'Stickman';
        const bodyMat = this.getColoredMaterial(isStickman ? 'stickman' : 'vehicle', color);
        for (const mr of node.getComponentsInChildren(MeshRenderer)) {
            const n = mr.node.name;
            let mat: Material;
            if (n.includes('_S')) mat = this.shadowMat;
            else if (n.includes('Wheel')) mat = this.tireMat;
            else mat = bodyMat;
            for (let i = 0; i < mr.sharedMaterials.length; i++) mr.setSharedMaterial(mat, i);
        }
        return node;
    }

    /**
     * Lấy material thân theo (loại, màu) từ cache — tạo lần đầu bằng cách copy
     * material gốc rồi set `mainColor`. Tối đa 8 material (2 loại × 4 màu) cho
     * cả ván thay vì mỗi object một bản.
     *
     * @param kind 'vehicle' dùng vehicleMat gốc, 'stickman' dùng stickmanMat.
     * @param color Màu gameplay (tra COLOR_PALETTE).
     * @returns Material share — KHÔNG mutate ở chỗ khác.
     */
    private getColoredMaterial(kind: 'vehicle' | 'stickman', color: GameColor): Material {
        const key = `${kind}:${color}`;
        let mat = this.materialCache.get(key);
        if (!mat) {
            mat = new Material();
            mat.copy(kind === 'vehicle' ? this.vehicleMat : this.stickmanMat);
            const [r, g, b] = COLOR_PALETTE[color];
            mat.setProperty('mainColor', new Color(r, g, b, 255));
            this.materialCache.set(key, mat);
        }
        return mat;
    }

    /**
     * Xử lý tap: chiếu vị trí các xe TAP ĐƯỢC (xe đầu mỗi hàng chờ + xe đang
     * đậu) lên màn hình, chọn xe gần điểm chạm nhất trong bán kính cho phép
     * (max(60px, 7% chiều cao màn) — thân thiện ngón tay trên mobile) rồi
     * chuyển cho GameManager xử lý. Không raycast/collider.
     *
     * @param ev Sự kiện chạm từ hệ thống input.
     */
    private onTouch(ev: EventTouch): void {
        if (this.manager.state !== GameState.Playing) return;
        const touch = ev.getLocation();
        const screenPos = new Vec3();
        let best: { kind: 'queue' | 'parked'; index: number } | null = null;
        let bestDist = Math.max(60, this.camera.camera.height * 0.07);

        const consider = (v: VehicleAgent, kind: 'queue' | 'parked', index: number) => {
            this.camera.worldToScreen(v.pos, screenPos);
            const d = Math.hypot(screenPos.x - touch.x, screenPos.y - touch.y);
            if (d < bestDist) {
                bestDist = d;
                best = { kind, index };
            }
        };

        this.manager.queues.forEach((q, qi) => {
            if (q.length > 0) consider(q[0], 'queue', qi);
        });
        this.manager.parking.forEach((v, slot) => {
            if (v) consider(v, 'parked', slot);
        });

        if (!best) return;
        const picked = best as { kind: 'queue' | 'parked'; index: number };
        if (picked.kind === 'queue') this.manager.tapQueueHead(picked.index);
        else this.manager.tapParkedSlot(picked.index);
    }
}

/**
 * Tìm node đầu tiên mang tên `name` trong cây con (duyệt sâu đệ quy).
 *
 * @param root Gốc cây cần tìm (null trả về null luôn — tiện chain getChildByName).
 * @param name Tên node chính xác.
 * @returns Node tìm thấy hoặc null.
 */
function findChildByName(root: Node | null, name: string): Node | null {
    if (!root) return null;
    if (root.name === name) return root;
    for (const child of root.children) {
        const found = findChildByName(child, name);
        if (found) return found;
    }
    return null;
}
