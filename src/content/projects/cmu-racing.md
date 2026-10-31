---
title: "Carnegie Mellon Racing"
image: "./CMR_Logo.png"
alt: "CMR logo"
summary: "Localization and path planning for an autonomous racecar."
role: "Localization Lead, path planning software developer"
dateRange: "Carnegie Mellon University"
expandable: true
organization: "Carnegie Mellon Racing (Autonomous Formula Racing)"
period: "Sept. 2025 – Present"
techStack: ["C++", "Python", "Docker", "ROS 2"]
animation: "racing-speed-lines"
order: 2
media:
  - type: video
    src: "/media/cmr/skidpad-run.mp4"
    poster: "/media/cmr/skidpad-run.jpg"
    width: 1280
    height: 720
    alt: "The autonomous racecar driving a figure-eight skidpad course marked with cones"
    caption: "A full autonomous skidpad run."
  - type: video
    src: "/media/cmr/skidpad-foxglove.mp4"
    poster: "/media/cmr/skidpad-foxglove.jpg"
    width: 2448
    height: 1440
    alt: "A Foxglove window showing the car's position and the skidpad cones during the run"
    caption: "The same run in Foxglove, which I used to check localization against recorded data."
---

Localization development for CMU's driverless FSAE team

- Implemented a real-time Extended Kalman Filter to fuse multi-sensor data for localization, validated against rosbag recordings using Foxglove and deployed for autonomous operation
- Developed a simulation tool in Python that tests candidate racing lines using vehicle dynamics models, enabling rapid evaluation and iteration
- Implemented minimum-curvature trajectory optimization, reducing simulated lap times by 20%
