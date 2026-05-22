# Air Fight ✈️💥

**Air Fight** is a tactical, turn-based vector dogfight game played on simulated quad-ruled grid paper. It simulates the classic pen-and-paper vector physics game (often known as Racetrack or Vector Rally), where players navigate planes by controlling their acceleration vector, avoiding inertia-induced crashes while trying to eliminate the enemy team.

---

## 🎮 Game Rules

### 1. Flight & Inertia (Vector Movement)
- Each plane has a current **velocity vector** `(vx, vy)`.
- At the start of a turn, the plane's **inertial anchor** is projected at `(x + vx, y + vy)`.
- You can adjust your speed by accelerating or decelerating by up to 1 unit in any direction (including diagonally). This gives you a **$3 \times 3$ grid of highlighted options** around your inertial anchor.
- Choosing a point updates your position and updates your velocity vector to reflect the acceleration.
- **Crash Condition**: If a plane goes outside the boundaries, or if all of its $3 \times 3$ options are outside the boundaries (leaving it with no in-field moves), it crashes and is eliminated.

### 2. Turrets
- Turrets act as crawling defensive batteries. They can move exactly **1 tile** in any direction per turn.
- Turrets have a firing range of **5 tiles** (Chebyshev/L-infinity or Manhattan/Taxicab distance). Any enemy plane entering this range is immediately shot down and eliminated.

### 3. Combat & Elimination
- **Bombing Run**: An active plane can destroy any enemy plane or turret by landing within **1 tile** of them.
- **Collision**: If two planes occupy the exact same grid point at the end of a turn, they crash and both are eliminated.
- **Victory**: The team that eliminates all enemy tokens (or all enemy planes) wins the fight.

---

## 🛠️ Features

- **Custom Board Sizes**: Configure the field size dynamically (Width: 12-80, Height: 16-96).
- **Squad Customization**: Fight with 1 to 7 planes and up to 2 turrets per team.
- **Inertial Metrics**: Choose between **L-Infinity** (Chebyshev/eight-way movement) or **Taxicab** (Manhattan/four-way movement) distance calculations.
- **Computer AI Opponent**: Play solo against a smart AI that targets enemy planes, avoids turret ranges, and manages its speed to prevent crashes.
- **Replay System**: Review your entire fight with smooth step-by-step sliding animations, dynamic explosion effects, and active turn/status updates.

---

## 🚀 Getting Started

The game is built with pure vanilla HTML5, CSS3, and JavaScript, requiring no dependencies or builds.

1. Clone the repository.
2. Open `index.html` in any modern web browser.
3. Configure your settings on the left sidebar and click **New fight**!
