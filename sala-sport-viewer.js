import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The gallery owns this instance and disposes it before displaying an image.
export function mountSportViewer(container, src) {
    const canvas = container.querySelector('canvas');
    const status = container.querySelector('[role="status"]');
    const reset = container.querySelector('[data-reframe]');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f8fa');
    scene.environmentIntensity = .3;
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = false;
    const ambient = new THREE.AmbientLight(0xffffff, .95);
    const light = new THREE.DirectionalLight(0xffffff, 4.65);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.radius = 2.5;
    light.shadow.intensity = 1;
    light.shadow.bias = -.0043;
    light.shadow.normalBias = .018;
    scene.add(ambient, light, light.target);
    const edgeScene = new THREE.Scene();
    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#626b74', transparent: true, opacity: .3, depthWrite: false });
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
    const composer = new EffectComposer(renderer, target);
    const beauty = new RenderPass(scene, camera);
    const ao = new SSAOPass(scene, camera, 1, 1);
    ao.output = SSAOPass.OUTPUT.Default;
    ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = 1;
    ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = 1;
    ao.copyMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    ao.copyMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    ao.copyMaterial.uniforms.opacity.value = 1;
    ao.minDistance = .0001;
    ao.maxDistance = .1;
    const lines = new RenderPass(edgeScene, camera);
    lines.clear = false;
    const output = new OutputPass();
    for (const pass of [beauty, ao, lines, output]) composer.addPass(pass);
    let disposed = false, loaded = false, radius = 1, environment = null, worker = null;
    let modelCorners = [], sceneCorners = [];
    let previousTime = 0;
    const lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    const lastRotation = new THREE.Quaternion();
    const direction = new THREE.Vector3(), relative = new THREE.Vector3();
    const sheetMaterials = new Set(), glassMaterials = new Set();
    function corners(box) {
        const points = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
        return points;
    }
    function fitDistance() {
        const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
        const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
        return radius * 1.12 / Math.sin(Math.min(vertical, horizontal));
    }
    function updateClipping() {
        if (!loaded || (camera.position.equals(lastPosition) && camera.quaternion.equals(lastRotation))) return;
        camera.getWorldDirection(direction);
        const depth = point => relative.copy(point).sub(camera.position).dot(direction);
        camera.near = Math.max(radius * .01, Math.min(radius * .1, Math.min(...modelCorners.map(depth)) * .5));
        camera.far = Math.max(camera.near + radius, Math.max(...sceneCorners.map(depth)) + radius * .1);
        camera.updateProjectionMatrix();
        lastPosition.copy(camera.position);
        lastRotation.copy(camera.quaternion);
    }
    function frame() {
        camera.position.set(1.5, 1.15, 1.5).normalize().multiplyScalar(fitDistance());
        camera.zoom = 1;
        controls.target.set(0, 0, 0);
        camera.lookAt(controls.target);
        camera.updateProjectionMatrix();
        controls.update();
        updateClipping();
    }
    function resize() {
        if (disposed) return;
        const previousFit = fitDistance();
        const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height, false);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (loaded) {
            camera.position.sub(controls.target).multiplyScalar(fitDistance() / previousFit).add(controls.target);
            controls.maxDistance = Math.max(radius * 12, fitDistance() * 2);
            controls.update();
            updateClipping();
        }
    }
    function render(time) {
        controls.update(Math.min((time - previousTime) / 1000, .1));
        previousTime = time;
        updateClipping();
        ao.ssaoMaterial.uniforms.cameraNear.value = camera.near;
        ao.ssaoMaterial.uniforms.cameraFar.value = camera.far;
        ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
        composer.render();
    }
    function resume() { if (!disposed) renderer.setAnimationLoop(document.hidden ? null : render); }
    function pause() { renderer.setAnimationLoop(null); }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    reset.addEventListener('click', frame);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    resize();
    resume();
    const materialsOf = object => Array.isArray(object.material) ? object.material : [object.material];
    function disposeModel(root) {
        const geometries = new Set(), materials = new Set(), textures = new Set();
        root.traverse(object => {
            if (object.geometry) geometries.add(object.geometry);
            for (const material of materialsOf(object)) if (material) {
                materials.add(material);
                for (const value of Object.values(material)) if (value?.isTexture && value !== environment?.texture) textures.add(value);
            }
        });
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) { texture.dispose(); texture.source?.data?.close?.(); }
    }
    function addShadowContrast(material) {
        material.onBeforeCompile = shader => {
            shader.uniforms.viewerShadowContrast = { value: .35 };
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>\nuniform float viewerShadowContrast;')
                .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 - viewerShadowContrast * (1.0 - getShadowMask());\n#include <opaque_fragment>');
        };
        material.customProgramCacheKey = () => 'sport-shadow-contrast-v1';
    }
    async function loadEnvironment() {
        let hdr, pmrem;
        try {
            hdr = await new RGBELoader().loadAsync(new URL('./assets-3d/urban_courtyard_02_1k.hdr', import.meta.url).href);
            if (disposed) return;
            pmrem = new THREE.PMREMGenerator(renderer);
            environment = pmrem.fromEquirectangular(hdr);
            scene.environment = environment.texture;
            for (const material of [...sheetMaterials, ...glassMaterials]) {
                material.envMap = environment.texture;
                if (glassMaterials.has(material)) {
                    material.envMapIntensity = .35;
                    material.roughness = .25;
                    if (material.opacity === 0 && material.alphaTest > 0) {
                        material.opacity = .12; material.transparent = true;
                        material.alphaTest = 0; material.depthWrite = false;
                    }
                }
                material.needsUpdate = true;
            }
            renderer.shadowMap.needsUpdate = true;
        } finally { hdr?.dispose(); pmrem?.dispose(); }
    }
    function createEdges(meshes) {
        return new Promise((resolve, reject) => {
            worker = new Worker(new URL('./sala-sport-edges.js', import.meta.url), { type: 'module' });
            worker.onerror = () => { worker?.terminate(); worker = null; reject(new Error('edges')); };
            worker.onmessage = ({ data }) => {
                worker?.terminate(); worker = null;
                if (disposed) { resolve(); return; }
                if (data.error) { reject(new Error('edges')); return; }
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
                edgeScene.add(new THREE.LineSegments(geometry, edgeMaterial));
                resolve();
            };
            worker.postMessage({ meshes, threshold: 25 }, meshes.flatMap(mesh => mesh.indices ? [mesh.positions.buffer, mesh.indices.buffer] : [mesh.positions.buffer]));
        });
    }
    async function load() {
        try {
            const gltf = await new GLTFLoader().loadAsync(src, progress => {
                if (!disposed && progress.total) status.textContent = `Se încarcă modelul… ${Math.round(progress.loaded / progress.total * 100)}%`;
            });
            const model = gltf.scene;
            if (disposed) { disposeModel(model); return; }
            model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3());
            radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, .001);
            const root = new THREE.Group();
            root.position.copy(center).negate(); root.add(model); scene.add(root);
            scene.updateMatrixWorld(true);
            const processed = new Set(), meshes = [];
            model.traverse(object => {
                if (!object.isMesh) return;
                const materials = materialsOf(object);
                const isGlass = material => /glass|glazing/i.test(material.name);
                object.castShadow = materials.some(m => !m.transparent || m.opacity >= 1);
                object.receiveShadow = true;
                if (materials.every(isGlass)) { object.visible = false; object.castShadow = false; }
                else for (const m of materials) if (isGlass(m)) m.visible = false;
                for (const material of materials) {
                    if (processed.has(material)) continue;
                    processed.add(material);
                    material.polygonOffset = false; material.wireframe = false;
                    if (material.isMeshStandardMaterial) {
                        if (/^RAL_7024_(ACOPERIS|Fatade)(?:\.\d+)?$/i.test(material.name)) {
                            sheetMaterials.add(material);
                            material.envMapIntensity = .5; material.roughness = .16; material.metalness = .3;
                            if (material.isMeshPhysicalMaterial) material.specularIntensity = 1;
                        }
                        if (isGlass(material)) glassMaterials.add(material);
                        else if (!material.transparent) addShadowContrast(material);
                    }
                    material.needsUpdate = true;
                }
                const attribute = object.geometry.getAttribute('position');
                const positions = new Float32Array(attribute.count * 3);
                for (let i = 0; i < attribute.count; i++) {
                    positions[i * 3] = attribute.getX(i); positions[i * 3 + 1] = attribute.getY(i); positions[i * 3 + 2] = attribute.getZ(i);
                }
                const surface = materials.map(m => [m.color?.getHexString(), m.opacity, m.map?.uuid || '', m.metalness, m.roughness].join('/')).join('|');
                meshes.push({ positions, indices: object.geometry.index?.array.slice() ?? null, matrix: object.matrixWorld.toArray(), surface });
            });
            const elevation = -box.getSize(new THREE.Vector3()).y / 2 - radius * .001;
            const azimuth = THREE.MathUtils.degToRad(61), altitude = THREE.MathUtils.degToRad(30);
            light.position.set(Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(azimuth) * Math.cos(altitude)).multiplyScalar(radius * Math.sqrt(15.25));
            light.updateMatrixWorld(true); light.target.updateMatrixWorld(true);
            const sc = light.shadow.camera;
            sc.position.copy(light.position); sc.lookAt(light.target.position); sc.updateMatrixWorld(true);
            modelCorners = corners(box.clone().translate(center.clone().negate()));
            const shadowPoints = modelCorners.map(p => p.clone());
            const lightDirection = light.target.position.clone().sub(light.position).normalize();
            // Numerical bounds retain the established framing; no receiver geometry is created.
            for (const point of modelCorners) {
                const distance = (elevation - point.y) / lightDirection.y;
                if (distance >= 0) shadowPoints.push(point.clone().addScaledVector(lightDirection, distance));
            }
            const bounds = new THREE.Box3().setFromPoints(shadowPoints.map(p => p.applyMatrix4(sc.matrixWorldInverse)));
            const padding = radius * .02;
            Object.assign(sc, { left: bounds.min.x - padding, right: bounds.max.x + padding, bottom: bounds.min.y - padding, top: bounds.max.y + padding,
                near: Math.max(.01, -bounds.max.z - padding), far: -bounds.min.z + padding });
            sc.updateProjectionMatrix();
            const extent = radius * 2.5;
            sceneCorners = modelCorners.concat(corners(new THREE.Box3(new THREE.Vector3(-extent, elevation, -extent), new THREE.Vector3(extent, elevation, extent))));
            ao.kernelRadius = radius * .015 * .9;
            controls.minDistance = radius * .1; controls.maxDistance = Math.max(radius * 12, fitDistance() * 2);
            loaded = true; frame(); reset.disabled = false;
            renderer.shadowMap.needsUpdate = true;
            status.textContent = 'Se pregătește modelul…';
            const results = await Promise.allSettled([loadEnvironment(), createEdges(meshes)]);
            if (disposed) return;
            if (results.some(result => result.status === 'rejected')) status.textContent = 'Modelul este disponibil. Unele detalii nu s-au încărcat; reîncarcă pagina.';
            else { status.textContent = 'Model 3D pregătit.'; status.hidden = true; }
        } catch {
            if (!disposed) status.textContent = 'Modelul nu s-a putut încărca. Reîncearcă sau selectează o randare din galerie.';
        }
    }
    void load();
    return () => {
        disposed = true;
        pause(); worker?.terminate(); observer.disconnect(); controls.dispose();
        reset.removeEventListener('click', frame);
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('pagehide', pause); window.removeEventListener('pageshow', resume);
        disposeModel(scene); disposeModel(edgeScene); edgeMaterial.dispose();
        scene.environment = null; environment?.dispose(); light.shadow.dispose();
        for (const pass of composer.passes) pass.dispose?.();
        composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
    };
}
