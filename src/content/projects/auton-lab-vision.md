---
title: "DARPA Triage Challenge"
image: "./auton-lab-vision.png"
alt: "Auton Lab Logo"
summary: "Research on self-supervised vision transformers for medical triage."
role: "Research Intern"
dateRange: "CMU Auton Lab"
organization: "Auton Lab, Carnegie Mellon University"
cardBrand: "DARPA Triage Challenge"
cardTitle: "Auton Lab"
location: "Pittsburgh, PA"
period: "Jan. 2026 – Present"
techStack: ["Python", "PyTorch", "Hugging Face", "Docker"]
animation: "auton-lab-bounding-boxes"
order: 1
---

I research how well vision transformers can triage casualties from images, and got our DINOv3 model running inside the triage pipeline as a Docker inference server.

- Benchmarked DINOv3 against a VLM (Cosmos) on triage classification, then tried cropped, blurred, and full images centered on a casualty. Cropping with a little margin around the casualty beat the full image by 13%
- Used attention maps to catch a model leaning on background shortcuts instead of actual injury features, which traced back to a badly grouped train/test split behind a 12-point accuracy drop
- Prototyped a Bayesian network in Python that combines multiple observations into an injury estimate. In Monte Carlo sims it beat the standalone model by 13%
