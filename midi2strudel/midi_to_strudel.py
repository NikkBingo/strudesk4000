from mido import MidiFile
import math

# Convert MIDI note number to note name (e.g., 60 -> C4)
def note_name(midi_note):
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    name = notes[midi_note % 12]
    octave = (midi_note // 12) - 1
    return f"{name}{octave}"

# Load your MIDI file
midi = MidiFile("test.mid")

notes = []
durations = []
note_on_times = {}

# Collect note timings
for track in midi.tracks:
    current_time = 0
    for msg in track:
        current_time += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            note_on_times[msg.note] = current_time
        elif msg.type in ("note_off", "note_on") and msg.note in note_on_times:
            start_time = note_on_times.pop(msg.note)
            dur = (current_time - start_time) / midi.ticks_per_beat  # duration in beats
            notes.append(msg.note)
            durations.append(dur)

# Convert to note names and Strudel pattern
note_names = [note_name(n) for n in notes]
dur_values = [round(d, 3) for d in durations]

# Output Strudel code
print("\n🎶 Strudel pattern:\n")
print(f'n("{ " ".join(note_names) }").dur("{ " ".join(map(str, dur_values)) }")')
