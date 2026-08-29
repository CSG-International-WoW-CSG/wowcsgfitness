# WOW-CSG Fitness

Year-round **fitness companion** for CSG employees — track walks/runs, set personal goals, follow workouts, and cheer teammates.

**Slogan:** Move daily. Feel better.  
**Live site:** https://csg-international-wow-csg.github.io/wowcsgfitness/  
**Eligibility:** Open to all CSG employees (`@csgi.com`)

## What’s included

- **Home** — today ring, weekly KM, streak, editable daily goal
- **Track** — Outdoor GPS or treadmill live activity (KM, steps, pace, calories, map)
- **Workouts** — Easy Walk, Steady Run, Tempo, Long Session, Intervals, Free Activity
- **Community** — leaderboard + team activity feed
- **History** — recent saved sessions
- July 2026 day boards kept as an **archive** under Community

## How to use

### Web / PWA

1. Open the live site (or `index.html` locally)
2. Register / login with CSG email
3. Set your daily KM on **Home**, or pick a **Workout**, then **Track**

### Android (best lock-screen steps)

See **[ANDROID.md](./ANDROID.md)** — Capacitor wrapper with hardware step counter.

```bash
npm install
npm run android
```

### iPhone (free — no Mac)

See **[IOS.md](./IOS.md)**. Safari → **Add to Home Screen**.

## Customization

Edit `challengeConfig` at the top of `script.js`:

- `defaultGoalKm` — default personal daily goal
- `mode: 'fitness'` — year-round fitness shell
- July archive dates / `dayGoalsKm` still power historical day boards

## Support

Contact: wow-csg@csgi.com

---

**Every Step Counts!**  
#WOWCSGFitness #StepTogetherThriveTogether #WellnessAtCSG
