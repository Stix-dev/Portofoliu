// Edge-only topology analysis: rendered GLB geometry and materials are never modified.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

let candidates = null;
let angles = null;


function buildTopology(meshes) {
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const mesh of meshes) {
        const matrix = new THREE.Matrix4().fromArray(mesh.matrix);
        for (let i = 0; i < mesh.positions.length; i += 3) {
            point.fromArray(mesh.positions, i).applyMatrix4(matrix);
            bounds.expandByPoint(point);
        }
    }
    // Small, model-relative tolerance for positional seams, not a geometry simplification.
    const tolerance = Math.max(1e-7, Math.min(1e-4, bounds.getSize(point).length() * 1e-6));
    const vertices = [];
    const vertexIds = new Map();
    const faces = new Set();
    const adjacency = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const mesh of meshes) {
        const matrix = new THREE.Matrix4().fromArray(mesh.matrix);
        const ids = new Uint32Array(mesh.positions.length / 3);
        for (let i = 0; i < ids.length; i++) {
            point.fromArray(mesh.positions, i * 3).applyMatrix4(matrix);
            const key = `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)},${Math.round(point.z / tolerance)}`;
            let id = vertexIds.get(key);
            if (id === undefined) {
                id = vertices.length / 3;
                vertexIds.set(key, id);
                vertices.push(point.x, point.y, point.z);
            }
            ids[i] = id;
        }
        const count = mesh.indices ? mesh.indices.length : ids.length;
        for (let i = 0; i < count; i += 3) {
            const ia = ids[mesh.indices ? mesh.indices[i] : i];
            const ib = ids[mesh.indices ? mesh.indices[i + 1] : i + 1];
            const ic = ids[mesh.indices ? mesh.indices[i + 2] : i + 2];
            if (ia === ib || ib === ic || ic === ia) continue;
            // An unordered face key removes coincident triangles even with reversed winding.
            const faceKey = [ia, ib, ic].sort((x, y) => x - y).join(':');
            if (faces.has(faceKey)) continue;
            a.fromArray(vertices, ia * 3);
            b.fromArray(vertices, ib * 3);
            c.fromArray(vertices, ic * 3);
            normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
            if (normal.lengthSq() <= tolerance ** 4) continue;
            normal.normalize();
            faces.add(faceKey);
            const triangleIds = [ia, ib, ic];
            for (let j = 0; j < 3; j++) {
                const v0 = triangleIds[j];
                const v1 = triangleIds[(j + 1) % 3];
                const lo = Math.min(v0, v1);
                const hi = Math.max(v0, v1);
                const key = `${lo}:${hi}`;
                const edge = adjacency.get(key);
                if (!edge) {
                    adjacency.set(key, { lo, hi, nx: normal.x, ny: normal.y, nz: normal.z,
                        minDot: 1, count: 1, surface: mesh.surface, surfaceBoundary: false });
                } else {
                    // Face-plane angle is independent of winding; opposing coplanar faces are not creases.
                    const dot = Math.min(1, Math.abs(edge.nx * normal.x + edge.ny * normal.y + edge.nz * normal.z));
                    edge.minDot = Math.min(edge.minDot, dot);
                    edge.count++;
                    if (edge.surface !== mesh.surface) edge.surfaceBoundary = true;
                }
            }
        }
    }
    const segments = [];
    const creaseAngles = [];
    const planeEpsilon = THREE.MathUtils.degToRad(.5);
    for (const edge of adjacency.values()) {
        const angle = Math.acos(edge.minDot);
        // Keep open boundaries and visible material transitions at every threshold.
        const boundary = edge.count === 1;
        if (!boundary && !edge.surfaceBoundary && angle < planeEpsilon) continue;
        segments.push(...vertices.slice(edge.lo * 3, edge.lo * 3 + 3), ...vertices.slice(edge.hi * 3, edge.hi * 3 + 3));
        creaseAngles.push(boundary || edge.surfaceBoundary ? Infinity : THREE.MathUtils.radToDeg(angle));
    }
    candidates = new Float32Array(segments);
    angles = new Float32Array(creaseAngles);

    // Maps and source arrays are released after topology construction.
}

self.onmessage = ({ data }) => {
    try {
        if (data.meshes) buildTopology(data.meshes);
        if (!candidates) throw new Error('Missing edge topology');
        let count = 0;
        for (const angle of angles) if (angle >= data.threshold) count++;
        const positions = new Float32Array(count * 6);
        let offset = 0;
        for (let i = 0; i < angles.length; i++) {
            if (angles[i] < data.threshold) continue;
            positions.set(candidates.subarray(i * 6, i * 6 + 6), offset);
            offset += 6;
        }
        self.postMessage({ positions }, [positions.buffer]);
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
