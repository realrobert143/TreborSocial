// Open image in lightbox modal
function openMediaModal(imgSrc) {
    const modal = document.getElementById('mediaModal');
    const modalImg = document.getElementById('modalImage');
    if (modal && modalImg) {
        modalImg.src = imgSrc;
        modal.style.display = 'flex';
    }
}

// Close lightbox modal
function closeMediaModal() {
    const modal = document.getElementById('mediaModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Close modal when clicking on the dark backdrop
document.addEventListener('click', (e) => {
    const modal = document.getElementById('mediaModal');
    if (modal && e.target === modal) {
        closeMediaModal();
    }
});

// Close modal on pressing the Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeMediaModal();
    }
});