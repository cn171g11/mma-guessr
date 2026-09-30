/**
 * 全景查看器（equirectangular）· 仅用于腾讯街景可行性测试
 *
 * 腾讯街景瓦片拼合后是一张 2:1 的等距圆柱投影全景图（例如 8×4 块 512px 瓦片 = 4096×2048），
 * 因此这里把它贴到一个球体内表面渲染，而不是用立方体贴图。
 *
 * 朝向校正：全景图的水平中心（u=0.5）对应采集车行进方向 basic.dir（罗盘度，0=正北、顺时针）。
 * 推导（Three.js 球体 UV，相机默认朝 -Z）：
 *   设球体绕 Y 轴旋转 R 度、相机 yaw 为 θ，则画面内容对应的罗盘方位为  dir + 90 + R - θ；
 *   而相机自身朝向的罗盘方位为 -θ；两者相等才代表“看到的方向 = 现实方位”，
 *   故 R = -(dir + 90)。
 * 该式基于对腾讯字段语义的推断，页面提供滑块允许实测微调，便于接入前确认。
 */
(function (global) {
    'use strict';

    var TEXTURE_SIZE = 500; // 球体半径（相对值，只影响缩放无关的视觉）

    function QQPanoViewer(container) {
        this.container = container;
        this.dir = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.fov = 75;
        this.correction = 0;
        this.texture = null;
        this.dirty = true;
        this.onChange = null;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 2000);
        this.camera.rotation.order = 'YXZ';

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            // 测试页专用：开启后可在渲染循环之外把 canvas 画到 2D 画布做像素取样，
            // 便于自动化验证「是否真的画出了内容」。正式产品无需开启（有性能代价）。
            preserveDrawingBuffer: true,
        });
        this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
        // three r152+ 用 colorSpace，r149 及更早用 encoding，这里兼容两种
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if ('outputEncoding' in this.renderer && THREE.sRGBEncoding !== undefined) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        container.appendChild(this.renderer.domElement);

        this.mesh = null;
        this.loop = this.loop.bind(this);
        this.bindDrag();
        this.resize();
        requestAnimationFrame(this.loop);
    }

    QQPanoViewer.prototype.loop = function () {
        if (this.dirty) {
            this.dirty = false;
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
            this.camera.rotation.y = THREE.MathUtils.degToRad(this.yaw);
            this.camera.rotation.x = THREE.MathUtils.degToRad(this.pitch);
            if (this.mesh) this.mesh.rotation.y = THREE.MathUtils.degToRad(this.correction);
            this.renderer.render(this.scene, this.camera);
            if (typeof this.onChange === 'function') this.onChange(this.getState());
        }
        requestAnimationFrame(this.loop);
    };

    /** 装载一张拼好的全景 canvas */
    QQPanoViewer.prototype.setPanorama = function (canvas, dir) {
        var texture = new THREE.CanvasTexture(canvas);
        if ('colorSpace' in texture && THREE.SRGBColorSpace) {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else if ('encoding' in texture && THREE.sRGBEncoding !== undefined) {
            texture.encoding = THREE.sRGBEncoding;
        }
        texture.minFilter = THREE.LinearFilter;

        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.texture) this.texture.dispose();
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }

        var geometry = new THREE.SphereGeometry(TEXTURE_SIZE, 64, 40);
        var material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);

        this.texture = texture;
        this.dir = Number(dir) || 0;
        // 推导出的校正角：R = -(dir + 90)
        this.correction = -(this.dir + 90);
        // 初始视线对准采集方向（罗盘 dir ⇒ 相机 yaw = -dir）
        this.yaw = -this.dir;
        this.pitch = 0;
        this.dirty = true;
        return this;
    };

    QQPanoViewer.prototype.clear = function () {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
        this.dirty = true;
    };

    QQPanoViewer.prototype.setCorrection = function (deg) {
        this.correction = Number(deg) || 0;
        this.dirty = true;
    };

    QQPanoViewer.prototype.lookAtCompass = function (compassDeg) {
        this.yaw = -Number(compassDeg);
        this.dirty = true;
    };

    QQPanoViewer.prototype.setFov = function (fov) {
        this.fov = Math.max(20, Math.min(100, Number(fov) || 75));
        this.dirty = true;
    };

    /** 当前视角状态；compass 是相机自身朝向的罗盘方位 */
    QQPanoViewer.prototype.getState = function () {
        return {
            yaw: ((this.yaw % 360) + 360) % 360,
            pitch: this.pitch,
            fov: this.fov,
            dir: this.dir,
            correction: this.correction,
            compass: ((-this.yaw % 360) + 360) % 360,
        };
    };

    QQPanoViewer.prototype.bindDrag = function () {
        var self = this;
        var dom = this.renderer.domElement;
        var dragging = false;
        var lastX = 0;
        var lastY = 0;

        function down(e) {
            dragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
            dom.style.cursor = 'grabbing';
        }

        function move(e) {
            if (!dragging) return;
            var scale = self.fov / 900; // 视野越窄，同样的位移转得越慢，手感更稳
            var dx = e.clientX - lastX;
            var dy = e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            self.yaw += dx * scale * 1.6;
            self.pitch = Math.max(-85, Math.min(85, self.pitch + dy * scale * 1.6));
            self.dirty = true;
        }

        function up() {
            dragging = false;
            dom.style.cursor = 'grab';
        }

        dom.style.cursor = 'grab';
        dom.addEventListener('pointerdown', down);
        dom.addEventListener('pointermove', move);
        dom.addEventListener('pointerup', up);
        dom.addEventListener('pointercancel', up);
        dom.addEventListener('pointerleave', up);

        dom.addEventListener(
            'wheel',
            function (e) {
                e.preventDefault();
                self.setFov(self.fov + (e.deltaY > 0 ? 4 : -4));
            },
            { passive: false }
        );

        global.addEventListener('resize', function () {
            self.resize();
        });
    };

    QQPanoViewer.prototype.resize = function () {
        var w = this.container.clientWidth || 640;
        var h = this.container.clientHeight || 360;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.dirty = true;
    };

    global.QQPanoViewer = QQPanoViewer;
})(typeof window !== 'undefined' ? window : globalThis);
