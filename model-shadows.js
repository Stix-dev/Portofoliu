import * as THREE from 'three';

// Validated, model-independent directional shadows. No material/geometry edits.
export function fitDirectionalShadow(light, box, renderer) {
    const shadow = light.shadow;
    const camera = shadow.camera;
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    if (!(radius > 0) || !Number.isFinite(radius)) return null;

    // Keep the existing light direction/position. Fit in LIGHT space, not view space.
    light.updateWorldMatrix(true, false);
    light.target.updateWorldMatrix(true, false);
    shadow.updateMatrices(light);
    const bounds = new THREE.Box3();
    for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
                bounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));

    // Pixel budget, not an absolute world-unit density: identical results at any scale.
    const limit = renderer.capabilities.maxTextureSize || 2048;
    const resolution = 2 ** Math.floor(Math.log2(Math.min(2048, limit)));
    if (shadow.mapSize.x !== resolution || shadow.mapSize.y !== resolution) {
        shadow.map?.dispose(); shadow.map = null;
        shadow.mapSize.set(resolution, resolution);
    }
    const extent = bounds.getSize(new THREE.Vector3());
    const initialTexel = Math.max(extent.x, extent.y) / resolution;
    // Include filter taps and biased receiver positions at the frustum boundary.
    const padding = Math.max(radius * .01, initialTexel * 4);
    camera.left = bounds.min.x - padding;
    camera.right = bounds.max.x + padding;
    camera.bottom = bounds.min.y - padding;
    camera.top = bounds.max.y + padding;
    camera.near = Math.max(radius * 1e-5, -bounds.max.z - padding);
    camera.far = Math.max(camera.near + radius * 1e-5, -bounds.min.z + padding);
    const texelWorld = Math.max(camera.right - camera.left, camera.top - camera.bottom) / resolution;
    const depthRange = camera.far - camera.near;
    // PCF compares neighboring samples against one receiver depth. Sub-texel
    // normal offsets leave sloping planes self-shadowing. Keep offsets tied to
    // the actual footprint; convert the small depth offset to normalized depth.
    shadow.normalBias = 2 * texelWorld;
    shadow.bias = -.25 * texelWorld / depthRange;
    camera.updateProjectionMatrix();
    shadow.updateMatrices(light);
    shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    return { resolution, radius, texelWorld, depthRange,
        normalBias: shadow.normalBias, bias: shadow.bias,
        near: camera.near, far: camera.far,
        bounds: [camera.left, camera.right, camera.bottom, camera.top] };
}
