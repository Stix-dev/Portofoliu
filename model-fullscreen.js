// One fullscreen lifecycle for gallery media and standalone model viewers.
export function createFullscreenController(target, onChange = () => {}) {
    let enabled = false, fallback = false, pending = false, disposed = false;
    let previousOverflow = '';
    const inert = new Map();
    function update(value) {
        if (value === enabled) return;
        enabled = value;
        target.classList.toggle('is-fullscreen', value);
        target.classList.toggle('is-fallback-fullscreen', value && fallback);
        if (value) {
            previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            for (let branch = target; branch.parentElement; branch = branch.parentElement) {
                for (const sibling of branch.parentElement.children) if (sibling !== branch) {
                    inert.set(sibling, sibling.inert); sibling.inert = true;
                }
                if (branch.parentElement === document.body) break;
            }
            target.setAttribute('role', 'dialog'); target.setAttribute('aria-modal', 'true');
        } else {
            document.body.style.overflow = previousOverflow;
            for (const [element, value] of inert) element.inert = value;
            inert.clear(); target.removeAttribute('role'); target.removeAttribute('aria-modal');
        }
        onChange(value);
    }
    const changed = () => update(document.fullscreenElement === target || fallback);
    document.addEventListener('fullscreenchange', changed);
    async function enter() {
        if (enabled || pending || disposed) return;
        pending = true;
        try {
            if (!target.requestFullscreen) throw new Error('Fullscreen unavailable');
            await target.requestFullscreen();
            if (!disposed) changed();
            else if (document.fullscreenElement === target) await document.exitFullscreen();
        } catch { if (!disposed) { fallback = true; update(true); } }
        finally { pending = false; }
    }
    async function exit() {
        if (fallback) { fallback = false; update(false); }
        else if (document.fullscreenElement === target) await document.exitFullscreen();
    }
    return { enter, exit, get enabled() { return enabled; },
        dispose() {
            disposed = true; document.removeEventListener('fullscreenchange', changed);
            if (document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
            fallback = false; update(false);
        }
    };
}
