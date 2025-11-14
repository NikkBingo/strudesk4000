# Available Scales in Strudesk 4000

This document lists all scales currently available in the application and their note intervals (in semitones from the root).

## Scale List (in C)

### 1. **Major** (Ionian)
- **Notes in C:** C, D, E, F, G, A, B
- **Semitone intervals:** 0, 2, 4, 5, 7, 9, 11
- **Interval names:** 1P, 2M, 3M, 4P, 5P, 6M, 7M

### 2. **Minor** (Natural Minor / Aeolian)
- **Notes in C:** C, D, Eb, F, G, Ab, Bb
- **Semitone intervals:** 0, 2, 3, 5, 7, 8, 10
- **Interval names:** 1P, 2M, 3m, 4P, 5P, 6m, 7m

### 3. **Harmonic Minor**
- **Notes in C:** C, D, Eb, F, G, Ab, B
- **Semitone intervals:** 0, 2, 3, 5, 7, 8, 11
- **Interval names:** 1P, 2M, 3m, 4P, 5P, 6m, 7M

### 4. **Melodic Minor** (Ascending)
- **Notes in C:** C, D, Eb, F, G, A, B
- **Semitone intervals:** 0, 2, 3, 5, 7, 9, 11
- **Interval names:** 1P, 2M, 3m, 4P, 5P, 6M, 7M

### 5. **Dorian**
- **Notes in C:** C, D, Eb, F, G, A, Bb
- **Semitone intervals:** 0, 2, 3, 5, 7, 9, 10
- **Interval names:** 1P, 2M, 3m, 4P, 5P, 6M, 7m

### 6. **Phrygian**
- **Notes in C:** C, Db, Eb, F, G, Ab, Bb
- **Semitone intervals:** 0, 1, 3, 5, 7, 8, 10
- **Interval names:** 1P, 2m, 3m, 4P, 5P, 6m, 7m

### 7. **Lydian**
- **Notes in C:** C, D, E, F#, G, A, B
- **Semitone intervals:** 0, 2, 4, 6, 7, 9, 11
- **Interval names:** 1P, 2M, 3M, 4A, 5P, 6M, 7M

### 8. **Mixolydian**
- **Notes in C:** C, D, E, F, G, A, Bb
- **Semitone intervals:** 0, 2, 4, 5, 7, 9, 10
- **Interval names:** 1P, 2M, 3M, 4P, 5P, 6M, 7m

### 9. **Locrian**
- **Notes in C:** C, Db, Eb, F, Gb, Ab, Bb
- **Semitone intervals:** 0, 1, 3, 5, 6, 8, 10
- **Interval names:** 1P, 2m, 3m, 4P, 5d, 6m, 7m

### 10. **Blues**
- **Notes in C:** C, Eb, F, Gb, G, Bb
- **Semitone intervals:** 0, 3, 5, 6, 7, 10
- **Interval names:** 1P, 3m, 4P, 5d, 5P, 7m

### 11. **Pentatonic Major**
- **Notes in C:** C, D, E, G, A
- **Semitone intervals:** 0, 2, 4, 7, 9
- **Interval names:** 1P, 2M, 3M, 5P, 6M

### 12. **Pentatonic Minor**
- **Notes in C:** C, Eb, F, G, Bb
- **Semitone intervals:** 0, 3, 5, 7, 10
- **Interval names:** 1P, 3m, 4P, 5P, 7m

---

## Notes

- **Semitone intervals** are measured from the root note (0 = root)
- All scales shown are in the key of **C** for reference
- Scales can be transposed to any key using the Key selector in the application
- The application uses Tonal.js library for scale calculations
- Scales are applied to numeric patterns using `.scale()` modifier

