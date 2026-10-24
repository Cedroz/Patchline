// Keeps the last N frames of input plus the exact state at the start of that window.
import { cloneState, step, type State } from './sim';

export class InputRecorder {
  private inputs: number[] = [];
  private snapshot: State;

  constructor(
    start: State,
    private capacity = 1800, // 30 s at 60 Hz
  ) {
    this.snapshot = cloneState(start);
  }

  record(input: number): void {
    this.inputs.push(input);
    if (this.inputs.length > this.capacity) {
      // Advance the snapshot by the frame we are dropping so it stays aligned.
      this.snapshot = step(this.snapshot, this.inputs.shift()!);
    }
  }

  export(): { snapshot: State; inputs: number[] } {
    return { snapshot: cloneState(this.snapshot), inputs: [...this.inputs] };
  }
}
