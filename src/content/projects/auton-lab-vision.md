---
title: "Computer Vision Research --- DARPA Triage Challenge"
image: "./auton-lab-vision.png"
alt: "Auton Lab Logo"
summary: "Research on self-supervised vision transformers for medical triage."
role: "Research Intern"
dateRange: "CMU Auton Lab"
organization: "Auton Lab, Carnegie Mellon University"
location: "Pittsburgh, PA"
period: "Jan. 2026 – Present"
techStack: ["Python", "PyTorch", "Hugging Face", "Docker"]
animation: "auton-lab-bounding-boxes"
order: 1
---

Conducted research on vision models at Carnegie Mellon's Auton Lab, working on model development and evaluation for computer vision tasks.

- Benchmarked a vision transformer (DINOv3) against a VLM (Cosmos) on accuracy and latency for live triage, and containerized a REST-based DINOv3 inference server for integration into the triage pipeline
- Diagnosed a casualty-classification model relying on background shortcuts instead of real injury features using attention visualization, revealing a 12-point accuracy drop caused by an improperly grouped train/test split
- Prototyped a probabilistic model (Bayesian network) in Python that fused multiple observations into injury estimates, validated via Monte Carlo simulation to outperform standalone model output by 13%
