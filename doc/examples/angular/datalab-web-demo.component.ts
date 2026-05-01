// @ts-nocheck -- documentation snippet: ``@angular/core`` is not
// installed in this repo; type-checking is disabled so the file
// stays editor-clean.  In your real Angular project, remove this
// directive — actual types will apply.
/**
 * Standalone Angular component mirroring
 * ``public/remote-host-example.html`` from DataLab-Web.
 *
 * Renders a side panel of buttons next to the embedded DataLab-Web
 * iframe; each button drives the bridge through ``DataLabWebService``
 * and appends a JSON-formatted log line. Use it as a reference
 * implementation when you build your own host UI.
 *
 * Drop this file into your Angular app under, e.g.,
 * ``src/app/datalab-web/datalab-web-demo.component.ts``.
 */

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { DataLabWebFrameComponent } from './datalab-web-frame.component';
import { DataLabWebService } from './datalab-web.service';

interface LogLine {
  ts: string;
  kind: '→' | '←' | '✗' | '!';
  text: string;
}

@Component({
  selector: 'datalab-web-demo',
  standalone: true,
  imports: [DataLabWebFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout">
      <div class="panel">
        <h1>Remote control demo</h1>
        <div
          class="status"
          [class.ok]="dlw.ready()"
          [class.err]="dlw.lastError() !== null"
        >
          @if (dlw.lastError(); as err) {
            <span>Failed: {{ err.message }}</span>
          } @else if (dlw.ready()) {
            <span>Ready — DataLab-Web v{{ dlw.version() }}</span>
          } @else {
            <span>Booting…</span>
          }
        </div>

        <div class="row">
          <button [disabled]="!dlw.ready()" (click)="onVersion()">
            get_version
          </button>
          <button [disabled]="!dlw.ready()" (click)="onList()">
            list_signals
          </button>
        </div>

        <button [disabled]="!dlw.ready()" (click)="onAddSignal()">
          add_signal (sine)
        </button>
        <button [disabled]="!dlw.ready()" (click)="onAddImage()">
          add_image (gradient)
        </button>

        <div class="row">
          <button
            [disabled]="!dlw.ready() || lastId() === null"
            (click)="onFft()"
          >
            calc(fft) on last
          </button>
          <button
            [disabled]="!dlw.ready() || lastId() === null"
            (click)="onGet()"
          >
            get_signal_xy(last)
          </button>
        </div>

        <button
          [disabled]="!dlw.ready() || lastId() === null"
          (click)="onRemove()"
        >
          delete_object(last)
        </button>
        <button [disabled]="!dlw.ready()" (click)="onReset()">reset_all</button>

        <div class="counter">objects: {{ dlw.objectsCount() }}</div>

        <pre class="log" aria-live="polite">{{ logText() }}</pre>
      </div>

      <div class="frame-host">
        <datalab-web-frame
          (ready)="onFrameReady($event)"
          (failed)="onFrameFailed($event)"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .layout {
        display: flex;
        height: 100vh;
        font-family: system-ui, sans-serif;
      }
      .panel {
        width: 360px;
        padding: 12px;
        border-right: 1px solid #ccc;
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-y: auto;
      }
      .panel h1 {
        font-size: 16px;
        margin: 0 0 4px;
      }
      .panel button {
        padding: 6px 10px;
        cursor: pointer;
      }
      .panel button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .row {
        display: flex;
        gap: 6px;
      }
      .row > * {
        flex: 1;
      }
      .status {
        font-size: 12px;
        color: #555;
      }
      .status.ok {
        color: #2e7d32;
      }
      .status.err {
        color: #c62828;
      }
      .counter {
        font-size: 12px;
        color: #555;
      }
      .log {
        flex: 1;
        font-family: ui-monospace, Menlo, monospace;
        font-size: 12px;
        background: #111;
        color: #d4d4d4;
        padding: 8px;
        overflow: auto;
        white-space: pre-wrap;
        border: 1px solid #333;
        margin: 0;
      }
      .frame-host {
        flex: 1;
      }
    `,
  ],
})
export class DataLabWebDemoComponent {
  protected readonly dlw = inject(DataLabWebService);

  protected readonly lastId = signal<string | null>(null);
  private readonly lines = signal<LogLine[]>([]);

  protected readonly logText = () =>
    this.lines()
      .map((l) => `[${l.ts}] ${l.kind} ${l.text}`)
      .join('\n');

  // -----------------------------------------------------------------
  // Frame lifecycle
  // -----------------------------------------------------------------

  onFrameReady(version: string): void {
    this.append('←', `frame ready, v${version}`);
  }

  onFrameFailed(err: Error): void {
    this.append('✗', `frame failed: ${err.message}`);
  }

  // -----------------------------------------------------------------
  // Buttons
  // -----------------------------------------------------------------

  onVersion(): void {
    void this.wrap('get_version', () => this.dlw.getVersion());
  }

  onList(): void {
    void this.wrap('list_signals', () => this.dlw.listSignals());
  }

  async onAddSignal(): Promise<void> {
    const N = 256;
    // Typed arrays trigger the binary fast path even though the
    // sample is small — it's the right habit to take in real apps.
    const xs = new Float64Array(N);
    const ys = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      xs[i] = i / N;
      ys[i] = Math.sin(2 * Math.PI * 5 * xs[i]);
    }
    const id = await this.wrap('add_signal', () =>
      this.dlw.addSignal('Sine 5 Hz', xs, ys),
    );
    if (id) this.lastId.set(id);
  }

  async onAddImage(): Promise<void> {
    const N = 32;
    const data = new Float64Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        data[i * N + j] = i + j;
      }
    }
    const id = await this.wrap('add_image', () =>
      this.dlw.addImage('Gradient', { width: N, height: N, data }),
    );
    if (id) this.lastId.set(id);
  }

  onFft(): void {
    const id = this.lastId();
    if (!id) return this.note('no lastId — add a signal first');
    void this.wrap('calc(fft)', () => this.dlw.calc('fft', null, [id]));
  }

  onGet(): void {
    const id = this.lastId();
    if (!id) return this.note('no lastId');
    void this.wrap('get_signal_xy', () => this.dlw.getSignalXY(id));
  }

  async onRemove(): Promise<void> {
    const id = this.lastId();
    if (!id) return this.note('no lastId');
    await this.wrap('delete_object', () => this.dlw.deleteObject(id));
    this.lastId.set(null);
  }

  onReset(): void {
    void this.wrap('reset_all', () => this.dlw.resetAll());
    this.lastId.set(null);
  }

  // -----------------------------------------------------------------
  // Logging helpers
  // -----------------------------------------------------------------

  private append(kind: LogLine['kind'], text: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    this.lines.update((cur) => [...cur, { ts, kind, text }].slice(-200));
  }

  private note(text: string): void {
    this.append('!', text);
  }

  private async wrap<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    this.append('→', label);
    try {
      const result = await fn();
      const preview = JSON.stringify(result)?.slice(0, 200) ?? String(result);
      this.append('←', `${label} → ${preview}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.append('✗', `${label} → ${message}`);
      return null;
    }
  }
}
