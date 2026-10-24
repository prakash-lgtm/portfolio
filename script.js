(() => {
  const TOTAL_FRAMES = 240;
  const FOLDER_PATH = './frames-transparent';
  const LERP_FACTOR = 0.09; // Buttery-smooth cinematic inertia damping

  const canvas = document.getElementById('canvas');
  // Enable alpha transparency so canvas is 100% transparent around the subject
  const ctx = canvas.getContext('2d', { alpha: true });
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const frameCounter = document.getElementById('frame-counter');
  const copyBtn = document.getElementById('copy-btn');
  const toast = document.getElementById('toast');
  const backToTopBtn = document.getElementById('back-to-top');
  const giantPortfolioBg = document.querySelector('.giant-portfolio-bg');

  const images = new Array(TOTAL_FRAMES);
  let loadedCount = 0;
  let targetFrameFloat = 0;
  let currentFrameFloat = 0;
  let currentDrawnIndex = -1;
  let currentDrawnImage = null;

  function getFramePath(index) {
    const padded = String(index + 1).padStart(3, '0');
    return `${FOLDER_PATH}/ezgif-frame-${padded}.webp?v=4`;
  }

  function isFrameReady(img) {
    return Boolean(img && (img.isLoaded || (img.complete && img.naturalWidth > 0)));
  }

  // Load a single frame by index
  function requestFrame(i, onLoaded) {
    if (images[i]) {
      if (images[i].isLoaded && onLoaded) onLoaded(i);
      return;
    }
    const img = new Image();
    img.onload = () => {
      img.isLoaded = true;
      loadedCount++;
      if (onLoaded) onLoaded(i);
      // If scroll position is currently waiting near this frame, render smoothly
      if (Math.abs(currentFrameFloat - i) < 2.0) {
        renderFrame(currentFrameFloat);
      }
    };
    img.src = getFramePath(i);
    images[i] = img;
    if (img.complete && img.naturalWidth > 0) {
      img.isLoaded = true;
      if (onLoaded) onLoaded(i);
    }
  }

  // Two-phase priority preloader:
  // Phase 1: Preload keyframes every 4th frame (0, 4, 8... 239) with 12 concurrent streams.
  // Phase 2: Preload all remaining in-between frames.
  // Dynamic Priority: Whenever user scrolls, frames around the active position are loaded immediately!
  function preloadImages() {
    // 1. Instantly render hero frame 0
    requestFrame(0, () => renderFrame(0));

    // 2. Build prioritized download queue:
    // First, 60 evenly spaced keyframes across the whole animation
    const keyframes = [];
    for (let k = 4; k < TOTAL_FRAMES; k += 4) {
      keyframes.push(k);
    }

    // Next, all remaining in-between frames
    const remaining = [];
    for (let r = 1; r < TOTAL_FRAMES; r++) {
      if (r % 4 !== 0) {
        remaining.push(r);
      }
    }

    const downloadQueue = [...keyframes, ...remaining];
    const MAX_CONCURRENT = 12;
    let activeWorkers = 0;

    function processQueue() {
      while (activeWorkers < MAX_CONCURRENT && downloadQueue.length > 0) {
        const nextIdx = downloadQueue.shift();
        if (images[nextIdx] && images[nextIdx].isLoaded) {
          continue;
        }
        activeWorkers++;
        requestFrame(nextIdx, () => {
          activeWorkers--;
          processQueue();
        });
      }
    }

    for (let c = 0; c < MAX_CONCURRENT; c++) {
      processQueue();
    }

    // Expose prioritize function for dynamic scroll boost
    window.__prioritizeFrames = function(centerIdx) {
      const radius = 10;
      const minI = Math.max(0, centerIdx - radius);
      const maxI = Math.min(TOTAL_FRAMES - 1, centerIdx + radius);
      for (let i = minI; i <= maxI; i++) {
        if (!images[i]) {
          requestFrame(i);
        }
      }
    };
  }

  // Pixel-perfect canvas sizing with exact physical integer pixels
  function resizeCanvas() {
    if (!canvas) return;
    const displayWidth = Math.round(window.innerWidth);
    const displayHeight = Math.round(window.innerHeight);
    const dpr = window.devicePixelRatio || 1;

    const targetWidth = Math.round(displayWidth * dpr);
    const targetHeight = Math.round(displayHeight * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      currentDrawnIndex = -1;
      currentDrawnImage = null;
      renderFrame(currentFrameFloat);
    }
  }

  // Smooth, jitter-free frame resolver:
  // If target frame is ready, return it.
  // Otherwise search adjacent neighbor frames (up to ±6 frames).
  // With keyframes preloaded every 4 frames, a neighbor is ALWAYS ready immediately!
  function getBestAvailableFrame(targetIdx) {
    if (isFrameReady(images[targetIdx])) {
      return { img: images[targetIdx], index: targetIdx };
    }

    const maxWindow = 6;
    for (let offset = 1; offset <= maxWindow; offset++) {
      const prev = targetIdx - offset;
      if (prev >= 0 && isFrameReady(images[prev])) {
        return { img: images[prev], index: prev };
      }
      const next = targetIdx + offset;
      if (next < TOTAL_FRAMES && isFrameReady(images[next])) {
        return { img: images[next], index: next };
      }
    }

    if (currentDrawnIndex >= 0 && isFrameReady(images[currentDrawnIndex])) {
      return { img: images[currentDrawnIndex], index: currentDrawnIndex };
    }

    return isFrameReady(images[0]) ? { img: images[0], index: 0 } : null;
  }

  function renderFrame(floatIndex) {
    const targetIdx = Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.round(floatIndex)));
    const resolved = getBestAvailableFrame(targetIdx);
    if (!resolved) return;

    const { img, index: actualIdx } = resolved;

    // Avoid unnecessary redrawing of identical frame
    if (currentDrawnIndex === actualIdx && currentDrawnImage === img) {
      return;
    }

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || 1920;
    const ih = img.naturalHeight || 1080;

    // Cover math: preserves 16:9 while centering subject cleanly
    const scale = Math.max(cw / iw, ch / ih);
    const nw = Math.round(iw * scale);
    const nh = Math.round(ih * scale);

    // On mobile portrait (vertical phone screens), compose subject naturally
    const isMobilePortrait = cw < ch;
    const cx = isMobilePortrait
      ? Math.round(cw * 0.52 - nw * 0.52)
      : Math.round((cw - nw) / 2);
    const cy = Math.round((ch - nh) / 2);

    // Clear transparent canvas before drawing next frame
    ctx.clearRect(0, 0, cw, ch);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, nw, nh);

    currentDrawnImage = img;
    currentDrawnIndex = actualIdx;

    // Update frame counter UI indicator
    if (frameCounter) {
      const paddedNum = String(actualIdx + 1).padStart(3, '0');
      frameCounter.textContent = `FRAME ${paddedNum} / 240`;
    }
  }

  // Calculate target frame purely from scroll position
  function updateScrollTarget() {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollProgress = Math.min(1, Math.max(0, scrollY / maxScroll));

    // Map scroll progress linearly to frame range 0 to 239
    targetFrameFloat = scrollProgress * (TOTAL_FRAMES - 1);

    // Boost download priority for frames around the current scroll target
    if (window.__prioritizeFrames) {
      window.__prioritizeFrames(Math.round(targetFrameFloat));
    }

    // Parallax on giant background PORTFOLIO typography as user explores page
    if (giantPortfolioBg) {
      const heroThreshold = window.innerHeight * 0.75;
      const dim = Math.min(1, Math.max(0, scrollY / heroThreshold));
      giantPortfolioBg.style.opacity = (0.95 - dim * 0.55).toFixed(2);
      giantPortfolioBg.style.transform = `translate(-50%, calc(-50% - ${scrollY * 0.12}px))`;
    }
  }

  // RAF loop with smooth LERP damping (NO continuous auto-run!)
  function loop() {
    const diff = targetFrameFloat - currentFrameFloat;

    if (Math.abs(diff) > 0.02) {
      currentFrameFloat += diff * LERP_FACTOR;
      renderFrame(currentFrameFloat);
    } else if (currentFrameFloat !== targetFrameFloat) {
      currentFrameFloat = targetFrameFloat;
      renderFrame(currentFrameFloat);
    }

    requestAnimationFrame(loop);
  }

  // Also support interactive mouse/touch drag scrub directly on canvas
  let isDragging = false;
  let dragStartX = 0;
  let dragStartFrame = 0;

  if (canvasWrapper) {
    canvasWrapper.style.pointerEvents = 'auto';
    canvasWrapper.style.cursor = 'grab';

    canvasWrapper.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartFrame = currentFrameFloat;
      canvasWrapper.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const sensitivity = 0.6;
      targetFrameFloat = Math.min(
        TOTAL_FRAMES - 1,
        Math.max(0, dragStartFrame + deltaX * sensitivity)
      );
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        canvasWrapper.style.cursor = 'grab';
        updateScrollTarget();
      }
    });

    // Touch scrub (only for wide desktop trackpads/touch screens, never block mobile page scrolling)
    canvasWrapper.addEventListener('touchstart', (e) => {
      if (window.innerWidth <= 768) return; // Leave mobile gestures 100% native
      if (e.touches.length > 0) {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragStartFrame = currentFrameFloat;
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length === 0 || window.innerWidth <= 768) return;
      const deltaX = e.touches[0].clientX - dragStartX;
      targetFrameFloat = Math.min(
        TOTAL_FRAMES - 1,
        Math.max(0, dragStartFrame + deltaX * 0.6)
      );
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (window.innerWidth <= 768) return;
      isDragging = false;
      updateScrollTarget();
    });
  }

  // Mobile Navigation Drawer Toggle & Navigation
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileNavOverlay = document.getElementById('mobile-nav-overlay');
  const mobileNavClose = document.getElementById('mobile-nav-close');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

  function openMobileMenu() {
    if (!mobileNavOverlay || !mobileMenuBtn) return;
    mobileNavOverlay.classList.add('open');
    mobileMenuBtn.classList.add('active');
    mobileMenuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    if (!mobileNavOverlay || !mobileMenuBtn) return;
    mobileNavOverlay.classList.remove('open');
    mobileMenuBtn.classList.remove('active');
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileNavOverlay.classList.contains('open');
      if (isOpen) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  if (mobileNavClose) {
    mobileNavClose.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileMenu();
    });
  }

  // Close mobile drawer when clicking a navigation anchor link
  mobileNavLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeMobileMenu();
    });
  });

  // Close mobile drawer on escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileNavOverlay && mobileNavOverlay.classList.contains('open')) {
      closeMobileMenu();
    }
  });

  // Copy email to clipboard with toast notification
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const email = 'prakash@kvgce.ac.in';
      navigator.clipboard.writeText(email).then(() => {
        showToast('Email copied to clipboard!');
      }).catch(() => {
        showToast('Email: prakash@kvgce.ac.in');
      });
    });
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // Back to top button
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Event Listeners
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('resize', () => {
    resizeCanvas();
    updateScrollTarget();
  });

  // Initialization
  resizeCanvas();
  updateScrollTarget();
  currentFrameFloat = targetFrameFloat;
  preloadImages();
  renderFrame(0);
  requestAnimationFrame(loop);
})();
