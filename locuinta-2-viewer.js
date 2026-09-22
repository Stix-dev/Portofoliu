import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Validated local rendering, with the production gallery mount/dispose lifecycle.
export function mountHouse2Viewer(container, src) {
    THREE.ColorManagement.enabled = true;
    const canvas = container.querySelector('canvas');
    const viewport = container;
    const status = container.querySelector('[role="status"]');
    const reset = container.querySelector('[data-reframe]');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f7f8fa');
    scene.environment = null;
    // Scene environment lights the original GLB materials without PBR overrides.
    scene.environmentIntensity = .3;
    const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    // OrbitControls also maps Shift + left drag to pan; keep its default speeds.
    const preventMenu = event => event.preventDefault();
    canvas.addEventListener('contextmenu', preventMenu);
    controls.autoRotate = false;
    controls.autoRotateSpeed = .6;
    const ambient = new THREE.AmbientLight(0xffffff, .95);
    // Validated lighting settings for this model.
    const shadowSettings = { directionalIntensity: 4.65, intensity: 1, mapSize: 4096 };
    const directional = new THREE.DirectionalLight(0xffffff, shadowSettings.directionalIntensity);
    directional.castShadow = true;
    directional.shadow.mapSize.set(shadowSettings.mapSize, shadowSettings.mapSize);
    directional.shadow.radius = 1;
    directional.shadow.intensity = shadowSettings.intensity;
    directional.shadow.bias = 0;
    directional.shadow.normalBias = .0138;
    scene.add(ambient, directional, directional.target);

    const edgeMaterial = new THREE.LineBasicMaterial({ color: '#626b74', transparent: true, opacity: .30, depthWrite: false });
    const edgeScene = new THREE.Scene();

    // Draw edges after the validated AO pass using the beauty depth buffer.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
    const composer = new EffectComposer(renderer, target);
    const beauty = new RenderPass(scene, camera);
    const ao = new SSAOPass(scene, camera, 1, 1);
    ao.output = SSAOPass.OUTPUT.Default;
    ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = 1;
    ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = 1;
    const lines = new RenderPass(edgeScene, camera);
    lines.clear = false;
    // Edges share the model camera and depth buffer.
    lines.enabled = true;
    const output = new OutputPass();
    composer.addPass(beauty);
    composer.addPass(ao);
    composer.addPass(lines);
    composer.addPass(output);
    ao.enabled = true;
    // Weight the existing AO composite: color *= (1 - intensity) + intensity * AO.
    // CopyShader scales RGBA by opacity. Retain DstColorFactor for the source,
    // adding the unoccluded destination fraction; intensity 1 matches the original pass.
    ao.copyMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    ao.copyMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    ao.copyMaterial.uniforms.opacity.value = 1;


    let disposed = false, environment = null, previousTime = 0;
    let radius = 1;
    const originalModelCenter = new THREE.Vector3();
    let modelLoaded = false;
    let worker = null;
    // Bounds retain the original GLB world coordinates, like the camera and target.
    let modelCorners = [];
    let sceneCorners = [];
    const viewDirection = new THREE.Vector3();
    const relativePoint = new THREE.Vector3();
    const lastClipPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    const lastClipRotation = new THREE.Quaternion();
    function boxCorners(box) {
        const corners = [];
        for (const x of [box.min.x, box.max.x])
            for (const y of [box.min.y, box.max.y])
                for (const z of [box.min.z, box.max.z])
                    corners.push(new THREE.Vector3(x, y, z));
        return corners;
    }
    function updateClippingPlanes() {
        if (!modelLoaded || (camera.position.equals(lastClipPosition)
            && camera.quaternion.equals(lastClipRotation))) return;
        camera.getWorldDirection(viewDirection);
        const depth = point => relativePoint.copy(point).sub(camera.position).dot(viewDirection);
        const closestModelDepth = Math.min(...modelCorners.map(depth));
        const farthestSceneDepth = Math.max(...sceneCorners.map(depth));
        // Retain the proven 0.1-radius near plane at normal viewing distances.
        // Approach the model with a smaller, bounded near plane rather than clipping close details.
        const near = Math.max(radius * .01, Math.min(radius * .1, closestModelDepth * .5));
        const far = Math.max(near + radius, farthestSceneDepth + radius * .1);
        if (camera.near !== near || camera.far !== far) {
            camera.near = near;
            camera.far = far;
            camera.updateProjectionMatrix();
        }
        lastClipPosition.copy(camera.position);
        lastClipRotation.copy(camera.quaternion);

    }
    function updateProjection() {
        camera.aspect = Math.max(viewport.clientWidth, 1) / Math.max(viewport.clientHeight, 1);
        camera.updateProjectionMatrix();
    }
    function fitDistance() {
        const verticalAngle = THREE.MathUtils.degToRad(camera.fov) / 2;
        const horizontalAngle = Math.atan(Math.tan(verticalAngle) * camera.aspect);
        return radius * 1.12 / Math.sin(Math.min(verticalAngle, horizontalAngle));
    }
    function frameModel() {
        // Approved composition; geometric center remains the reference for the zoom guard.
        camera.up.set(0, 1, 0);
        camera.fov = 35;
        camera.zoom = 1;
        updateProjection();
        controls.minDistance = radius * 1.02;
        // Flush residual damping before applying the reset position.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.target.set(0.5962620326439687, 0.5573463870175884, 0.15853079051538588);
        camera.position.set(28.067459906142545, 13.623454922664918, -27.94594469178921);
        camera.lookAt(controls.target);
        controls.update();
        controls.enableDamping = damping;
        protectCamera();
        updateClippingPlanes();
    }
    // Protect the world-space bounding sphere even when pan moves the orbit target.
    function protectCamera() {
        controls.minDistance = radius * 1.02;
        const offset = camera.position.clone().sub(originalModelCenter);
        if (offset.length() < controls.minDistance) {
            if (offset.lengthSq() < 1e-12) offset.set(1.5, 1.15, 1.5);
            const safePosition = offset.setLength(controls.minDistance).add(originalModelCenter);
            controls.target.add(safePosition.clone().sub(camera.position));
            camera.position.copy(safePosition);
        }
    }
    function resize() {
        if (disposed) return;
        const width = Math.max(viewport.clientWidth, 1);
        const height = Math.max(viewport.clientHeight, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height, false);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(width, height);
        updateProjection();
        if (modelLoaded) {
            // Preserve manual framing while reapplying the model-sized zoom guard.
            controls.maxDistance = Math.max(radius * 12, fitDistance() * 2);
            controls.update();
            protectCamera();
            updateClippingPlanes();
        }
    }
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();

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
        async function loadEnvironment() {
            let hdr, pmrem;
            try {
                hdr = await new RGBELoader().loadAsync(new URL('./assets-3d/urban_courtyard_02_1k.hdr', import.meta.url).href);
                if (disposed) return;
                pmrem = new THREE.PMREMGenerator(renderer);
                environment = pmrem.fromEquirectangular(hdr);
                scene.environment = environment.texture;
                renderer.shadowMap.needsUpdate = true;
            } finally { hdr?.dispose(); pmrem?.dispose(); }
        }
        function createEdges(meshes) {
            return new Promise((resolve, reject) => {
                worker = new Worker(new URL('./locuinta-2-edges.js', import.meta.url), { type: 'module' });
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

    function render(time) {
        controls.update(Math.min((time - previousTime) / 1000, .1));
        previousTime = time;
        if (modelLoaded) protectCamera();
        updateClippingPlanes();
        ao.ssaoMaterial.uniforms.cameraNear.value = camera.near;
        ao.ssaoMaterial.uniforms.cameraFar.value = camera.far;
        ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
        composer.render();
    }
    function resume() { if (!disposed) { previousTime = performance.now(); renderer.setAnimationLoop(document.hidden ? null : render); } }
    function pause() { renderer.setAnimationLoop(null); }
    reset.addEventListener('click', frameModel);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    resume();
    async function load() {
        try {
            const gltf = await new GLTFLoader().loadAsync(src, progress => {
                if (!disposed && progress.total) status.textContent = `Se încarcă modelul… ${Math.round(progress.loaded / progress.total * 100)}%`;
            });
        const model = gltf.scene;
        if (disposed) { disposeModel(model); return; }
        // Measure the complete model before adding edge overlays.
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, .001);
        const root = new THREE.Group();
        // Keep the original GLB transform and use its world-space center.
        originalModelCenter.copy(center).add(root.position);
        root.add(model);
        scene.add(root);
        scene.updateMatrixWorld(true);
        const meshes = [];
        model.traverse(object => {
            if (!object.isMesh) return;
            const surfaceMaterials = Array.isArray(object.material) ? object.material : [object.material];
            object.castShadow = surfaceMaterials.some(material => !material.transparent || material.opacity >= 1);
            object.receiveShadow = true;
            const geometry = object.geometry;
            const position = geometry.getAttribute('position');
            // GLTF attributes can share large buffers: transfer compact copies, never original GLB arrays.
            const positions = new Float32Array(position.count * 3);
            for (let i = 0; i < position.count; i++) {
                positions[i * 3] = position.getX(i);
                positions[i * 3 + 1] = position.getY(i);
                positions[i * 3 + 2] = position.getZ(i);
            }
            const indices = geometry.index ? geometry.index.array.slice() : null;
            // Compare actual visible material properties, rather than material names/primitive IDs.
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            const surface = materials.map(material => [material.color?.getHexString(), material.opacity,
                material.map?.uuid || '', material.metalness, material.roughness].join('/')).join('|');
            meshes.push({ positions, indices, matrix: object.matrixWorld.toArray(), surface });
        });
        // Match the exported object/node name, never the material name.
        model.traverse(node => {
            if (node.name !== 'Glass') return;
            node.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = false;
                child.receiveShadow = false;
            });
        });
        // Retain the previous numerical framing bounds without creating a receiver mesh.
        const framingElevation = box.min.y - radius * .001;
        directional.position.set(radius * 1.5, radius * 3, radius * 2);
        const lightDistance = directional.position.length();
        const lightAzimuth = THREE.MathUtils.degToRad(111);
        const lightElevation = THREE.MathUtils.degToRad(30);
        directional.position.set(Math.sin(lightAzimuth) * Math.cos(lightElevation), Math.sin(lightElevation), Math.cos(lightAzimuth) * Math.cos(lightElevation)).multiplyScalar(lightDistance);
        directional.position.add(center);
        directional.target.position.copy(center);
        // Fit only the shadow camera to the full building and its projection onto the ground.
        // Include all box corners, so recessed surfaces are inside the same volume.
        function fitLightShadow() {
        directional.updateMatrixWorld(true);
        directional.target.updateMatrixWorld(true);
        const shadowCamera = directional.shadow.camera;
        shadowCamera.position.setFromMatrixPosition(directional.matrixWorld);
        const shadowTarget = new THREE.Vector3().setFromMatrixPosition(directional.target.matrixWorld);
        shadowCamera.lookAt(shadowTarget);
        shadowCamera.updateMatrixWorld(true);
        const shadowDirection = shadowTarget.clone().sub(shadowCamera.position).normalize();
        const shadowPoints = boxCorners(box);
        for (const point of [...shadowPoints]) {
            const distance = (framingElevation - point.y) / shadowDirection.y;
            if (distance >= 0) shadowPoints.push(point.clone().addScaledVector(shadowDirection, distance));
        }
        const shadowBounds = new THREE.Box3().setFromPoints(
            shadowPoints.map(point => point.applyMatrix4(shadowCamera.matrixWorldInverse))
        );
        const shadowPadding = radius * .02;
        Object.assign(shadowCamera, {
            left: shadowBounds.min.x - shadowPadding, right: shadowBounds.max.x + shadowPadding,
            bottom: shadowBounds.min.y - shadowPadding, top: shadowBounds.max.y + shadowPadding,
            near: Math.max(.01, -shadowBounds.max.z - shadowPadding),
            far: -shadowBounds.min.z + shadowPadding
        });
        shadowCamera.updateProjectionMatrix();
        }
        fitLightShadow();
        renderer.shadowMap.needsUpdate = true;
        ao.kernelRadius = radius * .015;
        ao.minDistance = 0;
        ao.maxDistance = .1;
        const shadowContrast = { value: .43 };
        const patchedMaterials = new Set();
        // Shadow darkening uses the validated value without changing GLB PBR parameters.
        function enableShadowContrast() {
        model.traverse(object => {
            // Preserve the validated shadow contrast without changing PBR parameters.
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                if (!material?.isMeshStandardMaterial || material.transparent || /glass|glazing/i.test(material.name) || patchedMaterials.has(material)) continue;
                patchedMaterials.add(material);
                const previousCompile = material.onBeforeCompile;
                const previousKey = material.customProgramCacheKey();
                material.onBeforeCompile = function (shader, renderer) {
                    previousCompile.call(this, shader, renderer);
                    shader.uniforms.viewerShadowContrast = shadowContrast;
                    shader.fragmentShader = shader.fragmentShader
                        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>\nuniform float viewerShadowContrast;')
                        .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 - viewerShadowContrast * (1.0 - getShadowMask());\n#include <opaque_fragment>');
                };
                material.customProgramCacheKey = () => previousKey + '|viewer-shadow-contrast-v1';
                material.needsUpdate = true;
            }
        });
        }
        if (shadowContrast.value > 0) enableShadowContrast();
        ao.kernelRadius *= .25;
        modelCorners = boxCorners(box);
        const framingExtent = radius * 2.5;
        sceneCorners = modelCorners.concat(boxCorners(new THREE.Box3(
            new THREE.Vector3(center.x - framingExtent, framingElevation, center.z - framingExtent),
            new THREE.Vector3(center.x + framingExtent, framingElevation, center.z + framingExtent)
        )));
        controls.minDistance = radius * 1.02;
        controls.maxDistance = Math.max(radius * 12, fitDistance() * 2);
        modelLoaded = true;
        frameModel();
        updateClippingPlanes();

            reset.disabled = false;
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
        canvas.removeEventListener('contextmenu', preventMenu);
        reset.removeEventListener('click', frameModel);
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('pagehide', pause); window.removeEventListener('pageshow', resume);
        disposeModel(scene); disposeModel(edgeScene); edgeMaterial.dispose();
        scene.environment = null; environment?.dispose(); directional.shadow.dispose();
        for (const pass of composer.passes) pass.dispose?.();
        composer.dispose(); renderer.dispose(); renderer.forceContextLoss();
    };
}
