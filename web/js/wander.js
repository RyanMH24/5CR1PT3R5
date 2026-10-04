// @ts-check
/**
 * Gives idle agents a life between jobs: every so often one gets up, walks to a hangout spot
 * (coffee, the fridge, a whiteboard, small talk in the hall), stays a moment and goes back to
 * their seat. Purely cosmetic: it never moves an agent who has work, queued or otherwise.
 *
 * Deterministic given its random source and clock, so it can be tested without a browser.
 */

/** @typedef {import('./map.js').Hangout} Hangout */
/**
 * @typedef {object} Errand
 * @property {Hangout} spot
 * @property {number} [arrivedAt]  Set once the agent reaches the spot.
 * @property {number} linger  How long to stay once there, in ms.
 */

export const WANDER = {
  /** Agents out at once, so the office looks lived-in rather than like a fire drill. */
  maxOut: 5,
  /** Wait before an agent's first trip, so a fresh page doesn't send everyone at once. */
  firstTripMs: [4_000, 30_000],
  /** Wait between trips, counted from getting back. */
  betweenTripsMs: [25_000, 90_000],
  /** Time spent at the spot. */
  lingerMs: [6_000, 14_000],
};

export class Wanderer {
  /** @param {Hangout[]} spots @param {() => number} [random] */
  constructor(spots, random = Math.random) {
    this.spots = spots;
    this.random = random;
    /** @type {Map<string, Errand>} */
    this.errands = new Map();
    /** @type {Map<string, number>} When each idle agent may next head out. */
    this.nextTrip = new Map();
  }

  /**
   * Advance the schedule and return where each wandering agent should be.
   * @param {string[]} idleIds  Agents with nothing to do right now.
   * @param {number} now  Epoch ms.
   * @param {(id: string) => boolean} isWalking  Whether the agent is still on the way.
   * @returns {Map<string, Hangout>}
   */
  update(idleIds, now, isWalking) {
    const idle = new Set(idleIds);
    // Work comes first: anyone who got a job drops their errand on the spot.
    for (const id of [...this.errands.keys(), ...this.nextTrip.keys()]) {
      if (idle.has(id)) continue;
      this.errands.delete(id);
      this.nextTrip.delete(id);
    }

    for (const [id, errand] of this.errands) {
      if (isWalking(id)) continue;
      if (errand.arrivedAt === undefined) errand.arrivedAt = now;
      else if (now - errand.arrivedAt >= errand.linger) {
        this.errands.delete(id); // head back to the seat
        this.nextTrip.set(id, now + this.between(WANDER.betweenTripsMs));
      }
    }

    for (const id of idleIds) {
      if (this.errands.has(id)) continue;
      const due = this.nextTrip.get(id);
      if (due === undefined) {
        this.nextTrip.set(id, now + this.between(WANDER.firstTripMs));
        continue;
      }
      if (now < due || this.errands.size >= WANDER.maxOut) continue;
      const spot = this.freeSpot();
      if (!spot) continue;
      this.errands.set(id, { spot, linger: this.between(WANDER.lingerMs) });
      this.nextTrip.delete(id);
    }

    return new Map([...this.errands].map(([id, errand]) => [id, errand.spot]));
  }

  /** @returns {Hangout | undefined} */
  freeSpot() {
    const taken = new Set([...this.errands.values()].map((e) => e.spot.id));
    const free = this.spots.filter((s) => !taken.has(s.id));
    return free[Math.floor(this.random() * free.length)];
  }

  /** @param {number[]} range */
  between([min, max]) {
    return min + this.random() * (max - min);
  }
}
