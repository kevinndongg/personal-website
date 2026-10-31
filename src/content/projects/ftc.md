---
title: "FIRST Tech Challenge"
image: "./blucrulogo.png"
alt: "Blu Cru logo"
summary: "Full stack software development for autonomous & teleoperated robot. "
role: "Team Captain, Software Lead"
dateRange: "High School"
expandable: true
organization: "FIRST Tech Challenge, team 6417 (Int'l Robotics Competition)"
cardBrand: "FIRST Tech Challenge"
cardNote: "Blu Cru, #6417"
period: "Sept. 2022 – Aug. 2025"
techStack: ["Java", "OpenCV", "Python"]
animation: "ftc-gears"
order: 4
media:
  - type: image
    src: "./ftc-object-detection-camera.jpg"
    alt: "The robot camera's view of scattered red, yellow and blue samples, each outlined by a detection box"
    size: half
    caption: "Detections on the robot camera's view."
  - type: image
    src: "./ftc-object-detection-topdown.jpg"
    alt: "The same view warped to a top-down projection of the field, with the same detection boxes"
    size: half
    caption: "The same detections after a homography warp to the field plane, where positions are in real units."
  - type: video
    src: "/media/ftc/object-detection.mp4"
    poster: "/media/ftc/object-detection.jpg"
    width: 538
    height: 960
    alt: "The robot finds a sample with OpenCV, then reaches out with its arm and picks it up"
    size: half
    caption: "OpenCV finds the sample, a homography gives its position on the floor, and 2D inverse kinematics moves the arm to pick it up."
  - type: video
    src: "/media/ftc/hang.mp4"
    poster: "/media/ftc/hang.jpg"
    width: 720
    height: 1280
    alt: "The robot extends its arm and hangs from the rig"
    size: half
    caption: "The hang."
  - type: image
    src: "./ftc-arm-kinematics.jpg"
    alt: "Diagram of the robot's telescoping arm on its chassis, with the arm angle and the position of the arm's base marked"
    caption: "The arm's geometry for the forward and inverse kinematics."
  - type: youtube
    id: "jKsmP8jkICs"
    title: "A full practice match with robot 6417"
    poster: "/media/ftc/match-poster.jpg"
    start: 6
    caption: "A full practice match."
---

Competed in FIRST Tech Challenge, leading mechanical design and build for our team's robot. Iterated across multiple prototypes each season to improve drivetrain reliability, intake speed, and scoring accuracy under competition constraints.

- Designed and shipped the full software stack for a robot ranked in the top 0.1% worldwide
- Led team to become a playoff captain at the World Championship (top 32 in the world)
- Derived full forward and inverse kinematics for a 4-DOF telescoping arm and generated smooth end-effector trajectories using Hermite splines for precise, repeatable motion control
- Built an autonomous failsafe state machine fusing possession sensing, odometry, kinematics, and AprilTag localization to recover missed scoring attempts and avoid collisions, improving scoring consistency by 40%
