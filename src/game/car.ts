import type { Vec } from "./astar";
import type { CarDir } from "./sprites";

const MAX_SPEED = 96; // px/s
const ACCEL = 240;
const BRAKE = 260;
const TURN_RATE = 9; // rad/s
const WAYPOINT_RADIUS = 4;
const FINAL_RADIUS = 1.5;

export class Car {
  x: number;
  y: number;
  heading = 0;
  speed = 0;
  dir: CarDir = "d";
  path: Vec[] = [];

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  get moving() {
    return this.path.length > 0;
  }

  drive(path: Vec[]) {
    this.path = path;
  }

  stop() {
    this.path = [];
    this.speed = 0;
  }

  update(dt: number) {
    if (!this.path.length) {
      this.speed = Math.max(0, this.speed - BRAKE * dt);
      return;
    }

    const target = this.path[0];
    const last = this.path.length === 1;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < (last ? FINAL_RADIUS : WAYPOINT_RADIUS)) {
      this.path.shift();
      if (!this.path.length) this.speed = 0;
      return;
    }

    // steer toward the waypoint with a limited turn rate
    const want = Math.atan2(dy, dx);
    let err = want - this.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const turn = Math.min(Math.abs(err), TURN_RATE * dt);
    this.heading += Math.sign(err) * turn;

    // slow for sharp turns and for the final stop
    let top = MAX_SPEED * Math.max(0.3, Math.cos(Math.min(Math.abs(err), Math.PI / 2)));
    if (Math.abs(err) > 0.9) top = Math.min(top, 34);
    if (last) top = Math.min(top, Math.sqrt(2 * BRAKE * 0.6 * dist) + 10);
    else {
      let remaining = dist;
      for (let i = 1; i < this.path.length; i++)
        remaining += Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].y - this.path[i - 1].y);
      top = Math.min(top, Math.sqrt(2 * BRAKE * 0.6 * remaining) + 10);
    }

    this.speed = this.speed < top ? Math.min(top, this.speed + ACCEL * dt) : Math.max(top, this.speed - BRAKE * dt);

    const step = Math.min(this.speed * dt, dist);
    this.x += Math.cos(this.heading) * step;
    this.y += Math.sin(this.heading) * step;
    this.updateDir();
  }

  private updateDir() {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const horizontal = this.dir === "l" || this.dir === "r";
    // hysteresis so the sprite doesn't flicker on diagonals
    if (horizontal ? Math.abs(s) > Math.abs(c) + 0.25 : Math.abs(c) > Math.abs(s) + 0.25) {
      this.dir = Math.abs(c) > Math.abs(s) ? (c > 0 ? "r" : "l") : s > 0 ? "d" : "u";
    } else if (horizontal) this.dir = c >= 0 ? "r" : "l";
    else this.dir = s >= 0 ? "d" : "u";
  }
}
