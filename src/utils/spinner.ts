import chalk from 'chalk';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface SpinnerStream {
  isTTY?: boolean;
  write(chunk: string): boolean | void;
}

/** Lightweight, dependency-free terminal spinner with elapsed timer. */
export class Spinner {
  private text: string;
  private stream: SpinnerStream;
  private timer: NodeJS.Timeout | undefined;
  private frameIndex = 0;
  private startedAt = 0;
  private active = false;
  private rendered = false;

  constructor(text: string, stream: SpinnerStream = process.stderr) {
    this.text = text;
    this.stream = stream;
  }

  start(): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.startedAt = Date.now();

    if (!this.stream.isTTY) {
      return;
    }

    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.rendered) {
      this.stream.write('\r\x1b[K');
      this.rendered = false;
    }
    this.active = false;
  }

  elapsedSeconds(): string {
    const ms = this.startedAt ? Date.now() - this.startedAt : 0;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  setText(text: string): void {
    this.text = text;
    if (this.active && this.stream.isTTY) {
      this.render();
    }
  }

  private render(): void {
    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex += 1;
    const elapsed = chalk.gray(`(${this.elapsedSeconds()})`);
    this.stream.write(`\r\x1b[K${chalk.cyan(frame)} ${chalk.cyan(this.text)} ${elapsed}`);
    this.rendered = true;
  }
}
