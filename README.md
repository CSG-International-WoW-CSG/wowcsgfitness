# WoW-CSG 7 Days Fitness Challenge Website

A modern, interactive website for the **WOW-CSG 7 Days Fitness Challenge** with leaderboards, progress tracking, and activity logging. Powered by CSG International.

**Slogan:** Step Together. Thrive Together.  
**Dates:** 26 July – 1 August  
**Format:** Progressive Walk/Run — Day 1 = 1 KM … Day 7 = 7 KM  
**Rewards:** 7 Winners – One Winner Every Day!  
**Eligibility:** Open to All CSG Employees

## Features

- Employee registration and login
- Real-time step tracking (mapped to progressive KM daily goals)
- Screenshot OCR — upload fitness-app screenshots to extract step counts
- Dynamic leaderboard (Total, Today, Average)
- Streak tracking
- Progress visualization against each day's KM goal
- Activity history
- Local storage persistence (+ optional Firebase)
- Responsive design

### Daily Goals (progressive)

| Day | Date (2026) | Goal |
|-----|-------------|------|
| 1 | 26 Jul | 1 KM |
| 2 | 27 Jul | 2 KM |
| 3 | 28 Jul | 3 KM |
| 4 | 29 Jul | 4 KM |
| 5 | 30 Jul | 5 KM |
| 6 | 31 Jul | 6 KM |
| 7 | 1 Aug | 7 KM |

Step tracking uses ~**1,300 steps per KM** for progress % (editable in `script.js` → `challengeConfig.stepsPerKm`).

## How to Use

### Option 1: Local File (Quick Start)

1. Open `index.html` in a web browser
2. Register / login and start tracking when the challenge is live

### Option 2: Deploy

Use GitHub Pages, Netlify, Vercel, or any static host.  
Repo: https://github.com/CSG-International-WoW-CSG/wowcsgfitness

## Customization

Edit `challengeConfig` at the top of `script.js` to change dates, KM goals, or steps-per-KM conversion.

## Support

Contact: wow-csg@csgi.com

---

**Every Step Counts!**  
#WOWCSGFitnessChallenge #StepTogetherThriveTogether #WellnessAtCSG #EveryStepCounts
