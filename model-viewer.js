import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describeModelDownload } from './model-progress.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { fitDirectionalShadow } from './model-shadows.js';
import { viewerDefaults } from './viewer-defaults.js';
import { createFullscreenController } from './model-fullscreen.js';

// Shared baseline. Project data and experimental effects belong to the caller.
export function createModelViewer(container, config = {}) {
    const canvas = container.querySelector('canvas');
    const status = container.querySelector('[role="status"]');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f8fa');
    const camera = new THREE.PerspectiveCamera(config.fov ?? 35, 1, .01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = true;
    const ambient = new THREE.AmbientLight(0xffffff, viewerDefaults.ambient);
    const directional = new THREE.DirectionalLight(0xffffff, viewerDefaults.directional);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.intensity = viewerDefaults.darkness;
    scene.add(ambient, directional, directional.target);
    // Shared lighting control. Ambient is the unattenuated fill budget;
    // darkness also removes fill from surfaces facing away from the key light.
    // Applied identically in the site and laboratory.
    const baseLighting = { ambient: viewerDefaults.ambient, directional: viewerDefaults.directional, darkness: viewerDefaults.darkness };
    function setBaseLighting(settings = {}) {
        for (const key of ['ambient', 'directional', 'darkness']) {
            if (Number.isFinite(settings[key])) baseLighting[key] = Math.max(0, settings[key]);
        }
        baseLighting.darkness = Math.min(1, baseLighting.darkness);
        ambient.intensity = baseLighting.ambient * (1 - baseLighting.darkness);
        directional.intensity = baseLighting.directional;
        directional.shadow.intensity = baseLighting.darkness;
        renderer.shadowMap.needsUpdate = true;
        return { ...baseLighting, effectiveAmbient: ambient.intensity };
    }
    setBaseLighting();
    const fullscreenController = config.fullscreenController || createFullscreenController(container);
    const ownsFullscreen = !config.fullscreenController;
    const modelBox = new THREE.Box3();
    let shadowDiagnostics;
    const center = new THREE.Vector3();
    const direction = new THREE.Vector3(...(config.direction ?? [1.5, 1.15, 1.5])).normalize();
    const lightOffset = new THREE.Vector3(1.5, 2, 1);
    const offset = new THREE.Vector3();
    let manager, loadVersion = 0;
    let model, radius = 1, disposed = false, frameId, renderEffect = null;
    let width = 1, height = 1;
    const message = text => { if (status && !disposed) status.textContent = text; };
    const environmentManager = new THREE.LoadingManager();
    let environment, environmentTask, environmentEnabled = viewerDefaults.hdri, environmentError = null;
    scene.environmentIntensity = viewerDefaults.hdriIntensity;
    async function setEnvironment({ enabled = environmentEnabled, intensity = scene.environmentIntensity } = {}) {
        if (disposed) return;
        environmentEnabled = enabled;
        scene.environmentIntensity = Math.max(0, Math.min(1, intensity));
        if (!enabled) { scene.environment = null; return; }
        if (!environment) {
            environmentTask ??= new RGBELoader(environmentManager).loadAsync(
                new URL('./assets/environments/urban_courtyard_02_1k.hdr', import.meta.url).href
            ).then(texture => {
                if (disposed) { texture.dispose(); return; }
                texture.mapping = THREE.EquirectangularReflectionMapping;
                environment = texture; environmentError = null;
            }).catch(error => { environmentError = error; throw error; })
                .finally(() => { environmentTask = null; });
            await environmentTask;
        }
        if (!disposed) scene.environment = environmentEnabled ? environment : null;
    }
    function setShadows(enabled) {
        directional.castShadow = Boolean(enabled);
        scene.traverse(object => {
            for (const material of [].concat(object.material || [])) material.needsUpdate = true;
        });
        renderer.shadowMap.needsUpdate = true;
    }
    function resetBaseline() {
        lightOffset.set(1.5, 2, 1);
        positionLight();
        setBaseLighting(viewerDefaults); setShadows(viewerDefaults.shadows);
        return setEnvironment({ enabled: viewerDefaults.hdri, intensity: viewerDefaults.hdriIntensity });
    }
    function clipAndProtect() {
        if (!model) return;
        controls.minDistance = radius * 1.02;
        offset.copy(camera.position).sub(center);
        if (offset.length() < controls.minDistance) {
            if (offset.lengthSq() < 1e-12) offset.copy(direction);
            camera.position.copy(center).add(offset.setLength(controls.minDistance));
            camera.lookAt(controls.target);
        }
        const distance = camera.position.distanceTo(center);
        camera.near = Math.max(radius * .0001, (distance - radius) * .1);
        camera.far = Math.max(camera.near + radius * 4, distance + radius * 4);
        camera.updateProjectionMatrix();
    }
    function fit() {
        if (!model) return;
        // Clear pending orbit/pan damping before restoring the geometric pivot.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
        const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
        // Solve perspective containment for every world-box corner in the chosen
        // view basis. Unlike sphere fitting, depth/width/height all contribute.
        const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
        if (right.lengthSq() === 0) right.set(1, 0, 0);
        const up = new THREE.Vector3().crossVectors(direction, right).normalize();
        const padding = Math.max(1.02, config.padding ?? 1.08);
        let distance = radius * 1.02;
        for (const x of [modelBox.min.x, modelBox.max.x]) for (const y of [modelBox.min.y, modelBox.max.y]) for (const z of [modelBox.min.z, modelBox.max.z]) {
            const corner = new THREE.Vector3(x, y, z).sub(center);
            const depth = corner.dot(direction);
            distance = Math.max(distance, depth + padding * Math.abs(corner.dot(right)) / Math.tan(halfHorizontal),
                depth + padding * Math.abs(corner.dot(up)) / Math.tan(halfVertical));
        }
        controls.target.copy(center);
        camera.position.copy(center).addScaledVector(direction, distance);
        camera.lookAt(center);
        controls.update();
        controls.enableDamping = damping;
        clipAndProtect();
    }
    function resize() {
        width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fit();
        container.dispatchEvent(new CustomEvent('viewerresize', { detail: { width, height } }));
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    function positionLight() {
        directional.target.position.copy(center);
        directional.position.copy(center).addScaledVector(lightOffset, radius);
        directional.target.updateMatrixWorld();
        if (model) shadowDiagnostics = fitDirectionalShadow(directional, modelBox, renderer);
        renderer.shadowMap.needsUpdate = true;
    }
    function reverseLight() {
        lightOffset.x *= -1; lightOffset.z *= -1;
        positionLight();
    }
    function disposeObject(root) {
        const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
        root.traverse(object => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.skeleton) skeletons.add(object.skeleton);
            for (const material of [].concat(object.material || [])) {
                materials.add(material);
                for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            }
        });
        const bitmaps = new Set();
        textures.forEach(item => {
            for (const image of [].concat(item.source?.data || [])) if (typeof image?.close === 'function') bitmaps.add(image);
            item.dispose();
        });
        bitmaps.forEach(image => image.close());
        materials.forEach(item => item.dispose());
        geometries.forEach(item => item.dispose());
        skeletons.forEach(item => item.dispose());
        root.clear();
    }
    function cancelPendingLoad() {
        loadVersion++;
        manager?.abort();
        if (status) status.hidden = Boolean(model);
    }
    async function loadModel(nextConfig, beforeReplace = () => {}) {
        if (disposed) throw new Error('Viewerul este închis.');
        cancelPendingLoad();
        const version = loadVersion;
        const loadingManager = manager = new THREE.LoadingManager();
        const active = () => !disposed && version === loadVersion;
        let candidate;
        try {
            if (status) status.hidden = false;
            message(nextConfig.data ? 'Se citește modelul local…' : 'Se descarcă modelul 3D…');
            const loader = new GLTFLoader(loadingManager);
            const gltf = nextConfig.data
                ? await loader.parseAsync(nextConfig.data, '')
                : await loader.loadAsync(nextConfig.src, event => { if (active()) message(describeModelDownload(event)); });
            candidate = gltf.scene;
            if (!active()) { disposeObject(candidate); return null; }
            candidate.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(candidate, true);
            const bounds = [...box.min.toArray(), ...box.max.toArray()];
            if (box.isEmpty() || !bounds.every(Number.isFinite)) throw new Error('Modelul nu conține geometrie validă.');
            message('Se pregătește modelul 3D…');
            candidate.traverse(object => {
                if (!object.isMesh) return;
                // Preserve imported materials, textures, geometry, UV and transparency.
                object.castShadow = [].concat(object.material).some(m => !m.transparent || m.opacity >= 1);
                object.receiveShadow = true;
            });
            // Commit only after parsing/bounds validation. The previous model survives errors.
            beforeReplace();
            if (model) { scene.remove(model); disposeObject(model); }
            renderer.renderLists?.dispose();
            model = candidate;
            // Do not retain the local file's ArrayBuffer after GLTF parsing.
            const { data, ...settings } = nextConfig;
            config = settings;
            camera.fov = config.fov ?? 35;
            direction.fromArray(config.direction ?? [1.5, 1.15, 1.5]).normalize();
            box.getCenter(center);
            modelBox.copy(box);
            radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, .001);
            scene.add(model);
            positionLight(); fit();
            message('100% — Model 3D pregătit.');
            if (environmentError) message('Model pregătit; HDRI indisponibil: ' + environmentError.message);
            if (status) status.hidden = !environmentError;
            return model;
        } catch (error) {
            if (candidate && candidate !== model) disposeObject(candidate);
            if (!active()) return null;
            if (status) status.hidden = false;
            message('Modelul nu s-a putut încărca. Alege alt fișier sau un model configurat.');
            throw error;
        }
    }
    const environmentReady = setEnvironment().catch(error => {
        if (!disposed) { message('HDRI indisponibil: ' + error.message); if (status) status.hidden = false; }
        return null;
    });
    const ready = config.src || config.data ? loadModel(config) : Promise.resolve(null);
    function animate() {
        if (disposed) return;
        controls.update(); clipAndProtect();
        if (renderEffect) renderEffect(); else renderer.render(scene, camera);
        frameId = requestAnimationFrame(animate);
    }
    animate();
    return { ready, environmentReady, loadModel, cancelPendingLoad, renderer, scene, camera, controls, ambient, directional, center, setBaseLighting,
        setEnvironment, setShadows, resetBaseline, fullscreen: fullscreenController,
        get environmentError() { return environmentError; }, get shadowDiagnostics() { return shadowDiagnostics; },
        get model() { return model; }, get radius() { return radius; },
        get size() { return { width, height }; }, fit, reverseLight,
        setRenderEffect(fn) { renderEffect = fn; },
        dispose() {
            if (disposed) return;
            disposed = true; cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose();
            cancelPendingLoad();
            environmentManager.abort(); scene.environment = null; environment?.dispose(); environment = null;
            if (ownsFullscreen) fullscreenController.dispose();
            if (model) disposeObject(model);
            scene.clear(); model = null; renderEffect = null;
            directional.shadow.dispose(); renderer.dispose();
        }
    };
}
