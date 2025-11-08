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
DEFAULT_TEMPO_BPM = 120
tempo_events = []
tempo_bpm = DEFAULT_TEMPO_BPM  # default tempo

# Extract tempo information
for track in midi.tracks:
    for msg in track:
        if msg.type == "set_tempo":
            tempo_events.append(60_000_000 / msg.tempo)  # convert microseconds per beat to BPM

if tempo_events:
    tempo_bpm = tempo_events[0]

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

slow_factor = round(DEFAULT_TEMPO_BPM / tempo_bpm, 4) if tempo_bpm else 1.0
cpm_value = round(tempo_bpm * 4, 3)

# Create mini-notation pattern with @ for durations
mini_notation = " ".join([f"{note}@{dur}" for note, dur in zip(note_names, dur_values)])

# Output Strudel code
print("\n🎶 Strudel pattern (mini-notation):\n")
print(f"Tempo: {tempo_bpm} BPM\n")
print(f'note("{mini_notation}").cpm({cpm_value})')
print(f"\n💡 Mini-notation tip: The @weight syntax specifies duration in beats")
print(f"   Alternative tempo: .slow({slow_factor}) for relative timing")

if len(tempo_events) > 1:
    print(f"\n⚠️  Found {len(tempo_events)} tempo changes; using the first ({tempo_bpm} BPM).")
