import { createRoot } from "react-dom/client";
import "@fontsource/inter/700.css";
import "./styles.css";
import { sitePath } from "../../shared/app-urls";
document.documentElement.classList.toggle(
  "windows",
  navigator.userAgent.includes("Windows"),
);
function App() {
  return (
    <main>
      <header>
        <div className="logo">
          <img src={sitePath("logo.svg")} alt="D-TIS" />
        </div>
        <nav>
          <a href="#use">システムを使う</a>
          <a href="#about">システムのはじまり</a>
          <a href="#license">ライセンスなど</a>
        </nav>
      </header>
      <section className="hero" id="about">
        <div className="background" />
        <div className="copy">
          <h1>
            お店でも、学校でも、
            <br />
            乗り物をリアルタイムに
            <br />
            案内できます。
          </h1>
          <p>
            お客さま・生徒のみなさまに
            <br />
            乗り物にスムーズに乗ってもらえるよう、
            <br />
            1台、置いてみませんか？
          </p>
          <div className="links" id="use">
            <a href={sitePath("signage/")}>Signageを見る</a>
            <a href={sitePath("controller/")}>Controllerを使う</a>
          </div>
        </div>
      </section>
      <footer id="license">
        ※
        本サイトは、学校での課題研究により制作しています。
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
