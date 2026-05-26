# Air Fight ✈️💥

**Air Fight** is a tactical, turn-based vector dogfight game played on simulated quad-ruled grid paper. It simulates the classic pen-and-paper vector physics game (often known as Racetrack or Vector Rally), where players navigate planes by controlling their acceleration vector, avoiding inertia-induced crashes while trying to eliminate the enemy team.

---

## 🎮 Game Rules

### 1. Flight & Inertia (Vector Movement)
- Each plane has a current **velocity vector** `(vx, vy)`.
- At the start of a turn, the plane's **inertial anchor** is projected at `(x + vx, y + vy)`.
- You can adjust your speed by accelerating or decelerating by up to 1 unit in any direction (including diagonally). This gives you a **3x3 grid of highlighted options** around your inertial anchor.
- You can select moves via mouse clicks or by using the 3x3 keyboard layout (**Q, W, E, A, S, D, Z, X, C**). A thin dashed guiding line connects the active plane to the center/anchor option.
- Choosing a point updates your position and updates your velocity vector to reflect the acceleration.
- **Crash Condition**: If a plane touches or goes beyond any boundary, or if all of its 3x3 options are outside the boundaries (leaving it with no in-field moves), it crashes and is eliminated.

### 2. Turrets
- Turrets act as crawling defensive batteries. They can move exactly **1 tile** in any direction per turn.
- Turrets have a firing range of **5 tiles** measured in Manhattan/Taxicab distance. Any enemy plane entering this range is immediately shot down and eliminated.
- Projectiles cannot pass through obstacles; turrets are blocked from shooting through obstacle blocks.

### 3. Combat & Elimination
- **Bombing Run**: An active plane can destroy any enemy plane or turret by landing within **1 tile** of them measured in Chebyshev/L-infinity distance.
- **Collision & Trajectories**: If two tokens occupy the exact same grid point at the end of a turn, OR if the movement trajectory of any plane/turret passes through the location of another alive token (friend or foe), they crash and both are eliminated.
- **Victory**: The team that eliminates all enemy tokens (or all enemy planes) wins the fight.

### 4. Obstacles
- Randomly generated blobs of unpassable cells on the board.
- If a plane or turret touches or passes through any part of an obstacle during its movement segment, it immediately crashes and is eliminated.

---

## 🛠️ Features

- **Custom Board Sizes**: Configure the field size dynamically (Width: 12-80, Height: 16-96).
- **Squad Customization**: Fight with 1 to 7 planes and up to 2 turrets per team.
- **Fixed Distance Rules**: Planes always use **L-Infinity** (Chebyshev/eight-way) distance to hit targets, while turrets always use **Taxicab** (Manhattan/four-way) distance to fire.
- **Turret Attack Zones**: A visual option to toggle visual dashed colored diamonds indicating the exact range and danger zone of each alive turret on the grid.
- **Random Obstacles**: Choose between `None`, `Big`, `Small`, or `Any` obstacle presets. Generated cells use a sketchy diagonal hand-hatched blueprint style, respect a 3-cell outer border buffer, and maintain a starting zone safety buffer.
- **Premium Visuals & Laser Effects**: Fully styled with an architectural blueprint grid aesthetic, featuring electricity-flickering laser beams, traveling energy bolts, expanding shockwave rings, active plane guiding lines, and a delayed glassmorphic game-over screen.
- **Smart Computer AI Opponent**: Play solo against a smart AI that targets enemy planes, avoids turret ranges, avoids obstacle/token collisions using a recursive 3-step lookahead search, and manages speed dynamically.
- **Replay System**: Review your entire fight with smooth step-by-step sliding animations, dynamic explosion effects, laser firing replays, and active status updates.

---

## 🚀 Getting Started

The game is built with pure vanilla HTML5, CSS3, and JavaScript, requiring no dependencies or builds.

1. Clone the repository.
2. Open `index.html` in any modern web browser.
3. Configure your settings on the left sidebar and click **New fight**!
