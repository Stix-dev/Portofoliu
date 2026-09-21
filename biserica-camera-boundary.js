// Keep the camera outside the complete model envelope, including during pan/orbit.
// Swept collision prevents even a large wheel/touch step crossing the building.
export function constrainCameraMotion(start, end, bounds, clearance) {
    const min = bounds.min.map(v => v - clearance);
    const max = bounds.max.map(v => v + clearance);
    const epsilon = Math.max(clearance * 1e-5, 1e-9);
    let position = start.slice();
    let destination = end.slice();
    for (let iteration = 0; iteration < 3; iteration++) {
        const delta = destination.map((v, i) => v - position[i]);
        let enter = -Infinity, exit = Infinity, axis = -1, normal = 0;
        let misses = false;
        for (let i = 0; i < 3; i++) {
            if (Math.abs(delta[i]) < 1e-15) {
                if (position[i] < min[i] || position[i] > max[i]) misses = true;
                continue;
            }
            const a = (min[i] - position[i]) / delta[i];
            const b = (max[i] - position[i]) / delta[i];
            const near = Math.min(a, b), far = Math.max(a, b);
            if (near > enter) { enter = near; axis = i; normal = delta[i] > 0 ? -1 : 1; }
            exit = Math.min(exit, far);
        }
        if (misses || enter > exit || exit < 0 || enter > 1 || enter < 0 || axis < 0) return destination;
        position = position.map((v, i) => v + delta[i] * enter);
        position[axis] += normal * epsilon;
        // Discard only motion into the wall; preserve tangential pan/orbit motion.
        destination[axis] = position[axis];
    }
    return position;
}
