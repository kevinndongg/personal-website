const DURATION = "400ms";
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

export const pageSlide = {
  forwards: {
    old: [{ name: "pageSlideOutLeft", duration: DURATION, easing: EASING, fillMode: "both" }],
    new: [{ name: "pageSlideInRight", duration: DURATION, easing: EASING, fillMode: "both" }],
  },
  backwards: {
    old: [{ name: "pageSlideOutRight", duration: DURATION, easing: EASING, fillMode: "both" }],
    new: [{ name: "pageSlideInLeft", duration: DURATION, easing: EASING, fillMode: "both" }],
  },
};
