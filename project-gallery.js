const previewContainer = document.getElementById('main-preview-container');
const thumbnails = document.querySelectorAll('[data-image]');
const modelThumbnail = document.querySelector('[data-model]');

let scale = 1;
let pointX = 0;
let pointY = 0;
let panning = false;
let startX = 0;
let startY = 0;
let initialPinchDistance = 0;
let initialPinchScale = 1;
let isPinching = false;
let disposeModelViewer = null;
let previewVersion = 0;

const projectInfo = {
    'locuinte-colective.html': 'Rezidential · Planse si randari arhitecturale',
    'biserica-ortodoxa.html': 'Cladire de cult · Planse si randari arhitecturale',
    'locuinta-individuala.html': 'Rezidential · Planse si randari arhitecturale',
    'studiu-de-insorire.html': 'Analiza de insorire · Documentatie grafica',
    'locuinta-individuala-2.html': 'Rezidential · Planse si randari arhitecturale',
    'hala-de-productie.html': 'Industrial · Planse si randari arhitecturale'
};

function resetViewerState() {
    previewVersion++;
    disposeModelViewer?.();
    disposeModelViewer = null;
    scale = 1;
    pointX = 0;
    pointY = 0;
    panning = false;
    isPinching = false;
}

function addFullscreenButton() {
    const button = document.getElementById('fullscreen-button');
    button.addEventListener('click', toggleFullScreen);
}

function renderImage(src, alt) {
    resetViewerState();
    previewContainer.classList.remove('is-bim-model');
    previewContainer.innerHTML = `
        <div class="pan-scroll-container w-100 h-100 position-relative" id="zoom-container">
            <img src="${src}" alt="${alt}" class="pan-image" id="active-image" draggable="false">
        </div>
        <button class="btn btn-dark btn-sm position-absolute bottom-0 end-0 m-3 opacity-75 z-3" id="fullscreen-button" type="button">
            Full Screen &#10547;
        </button>
    `;

    const zoomContainer = document.getElementById('zoom-container');
    const image = document.getElementById('active-image');
    zoomContainer.addEventListener('wheel', zoom, { passive: false });
    zoomContainer.addEventListener('mousedown', startPan);
    zoomContainer.addEventListener('mousemove', pan);
    zoomContainer.addEventListener('mouseup', endPan);
    zoomContainer.addEventListener('mouseleave', endPan);
    zoomContainer.addEventListener('touchstart', touchStart, { passive: false });
    zoomContainer.addEventListener('touchmove', touchMove, { passive: false });
    zoomContainer.addEventListener('touchend', touchEnd);
    zoomContainer.addEventListener('touchcancel', touchEnd);
    image.addEventListener('contextmenu', (event) => event.preventDefault());
    addFullscreenButton();
}

function renderModel(src) {
    resetViewerState();
    const isSportProject = document.body.classList.contains('sport-project');
    const isChurchProject = modelThumbnail?.dataset.viewer === 'church';
    previewContainer.classList.toggle('is-bim-model', isSportProject || isChurchProject);
    if (isSportProject || isChurchProject) {
        const version = previewVersion;
        previewContainer.innerHTML = `
            <canvas class="sport-model-canvas" aria-label="${isChurchProject ? 'Biserica' : 'Sala de sport'} 3D: trage pentru rotire, folosește rotița sau două degete pentru zoom"></canvas>
            <p class="sport-model-status" role="status">Se încarcă modelul 3D…</p>
            <button class="btn btn-light btn-sm sport-model-reset" type="button" data-reframe disabled>Reîncadrează</button>
            <button class="btn btn-dark btn-sm position-absolute bottom-0 end-0 m-3 opacity-75 z-3" id="fullscreen-button" type="button">Full Screen &#10547;</button>`;
        addFullscreenButton();
        const viewerModule = isChurchProject ? './biserica-viewer.js' : './sala-sport-viewer.js';
        import(viewerModule).then(module => {
            if (version !== previewVersion) return;
            const mountViewer = isChurchProject ? module.mountChurchViewer : module.mountSportViewer;
            disposeModelViewer = mountViewer(previewContainer, src);
        }).catch(() => {
            if (version === previewVersion) previewContainer.querySelector('[role="status"]').textContent = 'Previzualizarea 3D nu este disponibilă. Selectează o randare din galerie.';
        });
        return;
    }
    // Perspective BIM preset; keep the GLB geometry and materials unchanged.
    const modelSettings = 'auto-rotate shadow-intensity="1"';
    previewContainer.innerHTML = `
        <model-viewer src="${src}" camera-controls ${modelSettings} class="w-100 h-100" alt="Model 3D"></model-viewer>
        <button class="btn btn-dark btn-sm position-absolute bottom-0 end-0 m-3 opacity-75 z-3" id="fullscreen-button" type="button">
            Full Screen &#10547;
        </button>
    `;
    addFullscreenButton();
}

function updateTransform() {
    const image = document.getElementById('active-image');
    if (image) image.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

function zoom(event) {
    event.preventDefault();
    scale = Math.min(5, Math.max(1, scale + (event.deltaY < 0 ? 0.15 : -0.15)));
    if (scale === 1) {
        pointX = 0;
        pointY = 0;
    }
    updateTransform();
}

function startPan(event) {
    if (scale <= 1) return;
    panning = true;
    startX = event.clientX - pointX;
    startY = event.clientY - pointY;
    document.getElementById('zoom-container').classList.add('is-dragging');
}

function pan(event) {
    if (!panning || isPinching) return;
    event.preventDefault();
    pointX = event.clientX - startX;
    pointY = event.clientY - startY;
    updateTransform();
}

function endPan() {
    panning = false;
    document.getElementById('zoom-container')?.classList.remove('is-dragging');
}

function pinchDistance(first, second) {
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function touchStart(event) {
    if (event.touches.length === 2) {
        event.preventDefault();
        isPinching = true;
        panning = false;
        initialPinchDistance = pinchDistance(event.touches[0], event.touches[1]);
        initialPinchScale = scale;
    } else if (event.touches.length === 1 && scale > 1) {
        panning = true;
        startX = event.touches[0].clientX - pointX;
        startY = event.touches[0].clientY - pointY;
    }
}

function touchMove(event) {
    if (event.touches.length === 2 && initialPinchDistance) {
        event.preventDefault();
        scale = Math.min(5, Math.max(1, initialPinchScale * pinchDistance(event.touches[0], event.touches[1]) / initialPinchDistance));
        if (scale === 1) {
            pointX = 0;
            pointY = 0;
        }
        updateTransform();
    } else if (event.touches.length === 1 && panning && scale > 1) {
        event.preventDefault();
        pointX = event.touches[0].clientX - startX;
        pointY = event.touches[0].clientY - startY;
        updateTransform();
    }
}

function touchEnd(event) {
    if (event.touches.length < 2) isPinching = false;
    if (!event.touches.length) {
        initialPinchDistance = 0;
        endPan();
    }
}

function toggleFullScreen() {
    if (!document.fullscreenElement) previewContainer.requestFullscreen?.();
    else document.exitFullscreen?.();
}

function updateActiveThumbnail(activeThumbnail) {
    thumbnails.forEach((thumbnail) => thumbnail.classList.remove('is-active'));
    modelThumbnail?.classList.remove('is-active');
    activeThumbnail.classList.add('is-active');
}

thumbnails.forEach((thumbnail) => {
    thumbnail.addEventListener('click', () => {
        const image = thumbnail.querySelector('img');
        renderImage(thumbnail.dataset.image, image.alt);
        updateActiveThumbnail(thumbnail);
    });
});

if (modelThumbnail) {
    modelThumbnail.addEventListener('click', () => {
        renderModel(modelThumbnail.dataset.model);
        updateActiveThumbnail(modelThumbnail);
    });
    renderModel(modelThumbnail.dataset.model);
    updateActiveThumbnail(modelThumbnail);
} else if (thumbnails.length) {
    const firstImage = thumbnails[0].querySelector('img');
    renderImage(thumbnails[0].dataset.image, firstImage.alt);
    updateActiveThumbnail(thumbnails[0]);
}

const currentPage = window.location.pathname.split('/').pop();
const projectNavigation = document.querySelector('main > .d-flex');
if (projectNavigation && projectInfo[currentPage]) {
    projectNavigation.insertAdjacentHTML(
        'afterend',
        `<section class="project-summary"><p>${projectInfo[currentPage]}</p></section>`
    );
}
