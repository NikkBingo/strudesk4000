/**
 * Pointer Tracker - Handles hover and proximity detection
 */

class PointerTracker {
  constructor(options = {}) {
    this.proximityThreshold = options.proximityThreshold || 100;
    this.hoverEnabled = options.hoverEnabled !== false;
    this.proximityEnabled = options.proximityEnabled !== false;
    
    this.trackedElements = new Set();
    this.hoveredElements = new Set();
    this.proximityElements = new Set();
    
    this.hoverCallbacks = new Map();
    this.proximityCallbacks = new Map();
    
    // Initialize pointer position to null - don't check proximity until mouse actually moves
    // This prevents false proximity triggers on page load
    this.pointerX = null;
    this.pointerY = null;
    this.hasMouseMoved = false;
    
    this.rafId = null;
    this.isTracking = false;
    
    // Bind methods
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.update = this.update.bind(this);
  }

  /**
   * Start tracking pointer movements
   */
  start() {
    if (this.isTracking) return;
    
    document.addEventListener('mousemove', this.handleMouseMove);
    this.isTracking = true;
    this.update();
  }

  /**
   * Stop tracking pointer movements
   */
  stop() {
    if (!this.isTracking) return;
    
    document.removeEventListener('mousemove', this.handleMouseMove);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isTracking = false;
  }

  /**
   * Handle mouse move events
   */
  handleMouseMove(event) {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.hasMouseMoved = true;
  }

  /**
   * Update loop for proximity detection
   */
  update() {
    if (!this.isTracking) return;
    
    // Don't check proximity/hover until mouse has actually moved
    // This prevents false triggers on page load
    if (!this.hasMouseMoved || this.pointerX === null || this.pointerY === null) {
      this.rafId = requestAnimationFrame(this.update);
      return;
    }
    
    // Check all tracked elements for proximity
    this.trackedElements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const distance = this.calculateDistance(this.pointerX, this.pointerY, rect);
      const isHovering = this.isPointerInside(this.pointerX, this.pointerY, rect);
      
      // Handle hover
      if (this.hoverEnabled) {
        if (isHovering && !this.hoveredElements.has(element)) {
          // Entered hover
          this.hoveredElements.add(element);
          const callback = this.hoverCallbacks.get(element);
          if (callback) {
            callback('enter', element);
          }
        } else if (!isHovering && this.hoveredElements.has(element)) {
          // Exited hover
          this.hoveredElements.delete(element);
          const callback = this.hoverCallbacks.get(element);
          if (callback) {
            callback('leave', element);
          }
        }
      }
      
      // Handle proximity
      if (this.proximityEnabled) {
        const isInProximity = distance <= this.proximityThreshold;
        
        if (isInProximity && !this.proximityElements.has(element)) {
          // Entered proximity
          this.proximityElements.add(element);
          const callback = this.proximityCallbacks.get(element);
          if (callback) {
            callback('enter', element, distance);
          }
        } else if (!isInProximity && this.proximityElements.has(element)) {
          // Exited proximity
          this.proximityElements.delete(element);
          const callback = this.proximityCallbacks.get(element);
          if (callback) {
            callback('leave', element, distance);
          }
        }
      }
    });
    
    this.rafId = requestAnimationFrame(this.update);
  }

  /**
   * Calculate distance from point to element boundary
   */
  calculateDistance(x, y, rect) {
    // Calculate closest point on rectangle to the pointer
    const closestX = Math.max(rect.left, Math.min(x, rect.right));
    const closestY = Math.max(rect.top, Math.min(y, rect.bottom));
    
    // Calculate distance
    const dx = x - closestX;
    const dy = y - closestY;
    
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check if pointer is inside element
   */
  isPointerInside(x, y, rect) {
    return x >= rect.left && 
           x <= rect.right && 
           y >= rect.top && 
           y <= rect.bottom;
  }

  /**
   * Register an element for tracking
   */
  trackElement(element, hoverCallback, proximityCallback) {
    this.trackedElements.add(element);
    
    if (hoverCallback) {
      this.hoverCallbacks.set(element, hoverCallback);
      // NOTE: Removed native event listeners to prevent race conditions with update loop
      // All hover and proximity detection now happens in the update() loop for consistency
    }
    
    if (proximityCallback) {
      this.proximityCallbacks.set(element, proximityCallback);
    }
    
    if (!this.isTracking) {
      this.start();
    }
  }

  /**
   * Unregister an element from tracking
   */
  untrackElement(element) {
    this.trackedElements.delete(element);
    this.hoveredElements.delete(element);
    this.proximityElements.delete(element);
    this.hoverCallbacks.delete(element);
    this.proximityCallbacks.delete(element);
  }

  /**
   * Set proximity threshold
   */
  setProximityThreshold(threshold) {
    this.proximityThreshold = Math.max(0, threshold);
  }

  /**
   * Enable/disable hover detection
   */
  setHoverEnabled(enabled) {
    this.hoverEnabled = enabled;
    if (!enabled) {
      this.hoveredElements.clear();
    }
  }

  /**
   * Enable/disable proximity detection
   */
  setProximityEnabled(enabled) {
    this.proximityEnabled = enabled;
    if (!enabled) {
      this.proximityElements.clear();
    }
  }

  /**
   * Get current proximity for an element
   */
  getProximity(element) {
    const rect = element.getBoundingClientRect();
    return this.calculateDistance(this.pointerX, this.pointerY, rect);
  }

  /**
   * Check if element is currently hovered
   */
  isHovered(element) {
    return this.hoveredElements.has(element);
  }

  /**
   * Check if element is currently in proximity
   */
  isInProximity(element) {
    return this.proximityElements.has(element);
  }
}

export default PointerTracker;

