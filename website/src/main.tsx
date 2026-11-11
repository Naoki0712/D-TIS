import "./styles.css";
import "../../shared/fonts.css";
import "./poster.js";
import { sitePath } from "../../shared/app-urls";
document.querySelectorAll<HTMLAnchorElement>("[data-app-link]").forEach(link => { link.href = sitePath(link.dataset.appLink + "/"); });
