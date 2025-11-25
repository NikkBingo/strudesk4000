const activeReasons = new Set();

function applyLockState() {
  const body = document.body;
  if (!body) {
    return;
  }
  if (activeReasons.size > 0) {
    body.style.overflow = 'hidden';
  } else {
    body.style.overflow = '';
  }
}

export function lockScroll(reason = 'global') {
  activeReasons.add(reason);
  applyLockState();
}

export function unlockScroll(reason = 'global') {
  if (reason) {
    activeReasons.delete(reason);
  } else {
    activeReasons.clear();
  }
  applyLockState();
}

export function forceUnlockScroll() {
  activeReasons.clear();
  applyLockState();
}

export function getScrollLockReasons() {
  return Array.from(activeReasons);
}

