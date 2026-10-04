import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Logo } from '../brand.jsx';
import { useModalDialog } from '../lib/modal.js';
import '../merch.css';

const PRODUCTS = [
  {
    id: 'tee', number: '01', name: 'The Everyday Tee', type: 'T-shirt', image: '/merch/tee.png',
    description: 'A simple tee with a little more to say. The dot. wordmark and our yellow mascot bring the Baseline spirit off the field.',
    idea: 'An everyday silhouette, designed around the dot. wordmark and mascot artwork.',
  },
  {
    id: 'puffer', number: '02', name: 'The Sideline Puffer', type: 'Puffer jacket', image: '/merch/puffer.png',
    description: 'For the people who show up on the sidelines. A puffer concept that puts dot. front and center, with our mascot along for the ride.',
    idea: 'A padded outerwear silhouette with understated branding and a playful mascot detail.',
  },
  {
    id: 'softshell', number: '03', name: 'The Club Softshell', type: 'Softshell jacket', image: '/merch/softshell.png',
    description: 'A clean layer for a shared purpose. Our softshell concept pairs the dot. wordmark with the familiar face behind Baseline.',
    idea: 'A streamlined zip-front silhouette for the dot. collection.',
  },
];

function Wordmark() {
  return <span className="merch-wordmark">dot<span>.</span></span>;
}

function Arrow({ diagonal = false }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function ProductDetails({ product, onClose }) {
  const dialogRef = useRef(null);
  useModalDialog(dialogRef, onClose);
  return createPortal(
    <div className="merch-page merch-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="merch-dialog" role="dialog" aria-modal="true" aria-labelledby="merch-details-title" aria-describedby="merch-details-copy" tabIndex={-1} ref={dialogRef}>
        <div className="merch-dialog-top">
          <span className="merch-eyebrow">The first collection / {product.number}</span>
          <button className="merch-close" aria-label="Close product details" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="merch-dialog-body">
          <figure className="merch-detail-image">
            <img src={product.image} width={1448} height={1086} alt={`Front and back design concept for the dot. ${product.type.toLowerCase()}`} />
            <figcaption>Front &amp; back · Design concept</figcaption>
          </figure>
          <div className="merch-detail-copy">
            <p className="merch-eyebrow merch-green">Coming soon</p>
            <h2 id="merch-details-title">{product.name}</h2>
            <p id="merch-details-copy">{product.description}</p>
            <dl>
              <div><dt>The idea</dt><dd>{product.idea}</dd></div>
              <div><dt>Final details</dt><dd>Materials, fit, sizing, and pricing will be announced before launch. Artwork shown is a concept and may change.</dd></div>
              <div><dt>The purpose</dt><dd>100% of profits will support concussion research. The beneficiary will be announced before sales begin.</dd></div>
            </dl>
            <button className="merch-button merch-button-outline" onClick={onClose}>Back to the collection <Arrow /></button>
          </div>
        </div>
      </section>
    </div>, document.body,
  );
}

export default function Merch() {
  const [selected, setSelected] = useState(null);
  return (
    <div className="merch-page" id="top">
      <a className="merch-skip" href="#collection">Skip to the collection</a>
      <div className="merch-announcement"><span>A little dot. A bigger purpose.</span><span>First collection — coming soon</span></div>
      <header className="merch-header merch-wrap">
        <div className="merch-brand-lockup">
          <a href="#top" className="merch-brand" aria-label="dot. home"><Wordmark /></a>
          <a href="/" className="merch-baseline"><Logo size={17} /><span>By Baseline</span></a>
        </div>
        <nav aria-label="Merch navigation">
          <a href="#collection">The collection</a>
          <a href="#research">Our purpose</a>
          <a href="/" className="merch-app-link">Back to Baseline <Arrow diagonal /></a>
        </nav>
      </header>

      <main>
        <section className="merch-hero merch-wrap" aria-labelledby="merch-hero-title">
          <div className="merch-hero-copy">
            <p className="merch-eyebrow"><span className="merch-status-dot" /> Apparel with a purpose</p>
            <h1 id="merch-hero-title">Know your<br /><em>baseline.</em></h1>
            <p className="merch-hero-description">Good gear. A familiar face.<br />A future with better concussion care.</p>
            <a className="merch-button" href="#collection">Meet the collection <Arrow /></a>
            <p className="merch-launch-note">The first dot. collection is coming soon.</p>
          </div>
          <figure className="merch-hero-art">
            <div className="merch-art-heading"><span>Wear a little purpose.</span><span>Collection No. 01</span></div>
            <img src="/merch/tee.png" width={1448} height={1086} alt="Front and back concept for the dot. T-shirt, featuring the wordmark and yellow mascot" fetchPriority="high" />
            <figcaption><span>The Everyday Tee</span><span>Design preview</span></figcaption>
          </figure>
        </section>

        <section className="merch-purpose-band" aria-label="Our research commitment">
          <div className="merch-wrap merch-purpose-inner">
            <p className="merch-purpose-number">100<span>%</span></p>
            <div><p className="merch-eyebrow">Of profits. For progress.</p><h2>Every piece has a purpose.<br />Concussion research.</h2></div>
            <a href="#research">Our commitment <Arrow diagonal /></a>
          </div>
        </section>

        <section className="merch-collection merch-wrap" id="collection" aria-labelledby="merch-collection-title">
          <div className="merch-section-heading">
            <div><p className="merch-eyebrow">01 / The first collection</p><h2 id="merch-collection-title">Made to mean more.</h2></div>
            <p>Three concepts. One shared purpose.<br />A first look at what’s ahead.</p>
          </div>
          <div className="merch-product-grid">
            {PRODUCTS.map(product => (
              <article className="merch-product" key={product.id}>
                <button className="merch-product-image" onClick={() => setSelected(product)} aria-label={`View ${product.name} details`}>
                  <span className="merch-product-number">{product.number}</span>
                  <img src={product.image} width={1448} height={1086} alt={`Front and back concept for the dot. ${product.type.toLowerCase()}`} loading="lazy" />
                  <span className="merch-image-note">Front &amp; back / Concept</span>
                </button>
                <div className="merch-product-heading"><h3>{product.name}</h3><span>Coming soon</span></div>
                <p>{product.type}</p>
                <button className="merch-details-link" onClick={() => setSelected(product)} aria-label={`View details for ${product.name}`}>View details <Arrow /></button>
              </article>
            ))}
          </div>
          <p className="merch-collection-note">A preview, for now. Final designs, materials, sizing, pricing, and launch timing will be shared before orders open.</p>
        </section>

        <section className="merch-research merch-wrap" id="research" aria-labelledby="merch-research-title">
          <div className="merch-research-heading">
            <p className="merch-eyebrow">02 / More than merch</p>
            <h2 id="merch-research-title">For the game.<br /><em>For the people.</em></h2>
            <div className="merch-baseline-mark" aria-label="Baseline">
              <Logo size={82} />
            </div>
          </div>
          <div className="merch-research-copy">
            <p className="merch-research-lead">We’re here for the people on the field, and everyone looking out for them.</p>
            <p>dot. is the apparel collection from Baseline. Our commitment is simple: 100% of profits from the collection will go toward concussion research.</p>
            <div className="merch-commitment-details">
              <div><span>01</span><div><h3>What “profits” means</h3><p>The amount remaining after the costs of making and selling the collection.</p></div></div>
              <div><span>02</span><div><h3>Where it will go</h3><p>The research beneficiary is still being selected. We’ll name them before sales begin.</p></div></div>
              <div><span>03</span><div><h3>What happens next</h3><p>We’ll share final product details, pricing, and the research commitment here before launch.</p></div></div>
            </div>
            <a className="merch-text-link" href="/">Get to know Baseline <Arrow diagonal /></a>
          </div>
        </section>
      </main>

      <footer className="merch-footer">
        <div className="merch-wrap merch-footer-inner">
          <div><a href="#top" className="merch-brand" aria-label="dot. back to top"><Wordmark /></a><p>A little dot. A bigger purpose.</p></div>
          <div className="merch-footer-links"><a href="#collection">The collection</a><a href="#research">Our purpose</a><a href="/">Back to Baseline <Arrow diagonal /></a></div>
          <p className="merch-footer-note">Coming soon.<br />No orders are being taken yet.</p>
        </div>
      </footer>
      {selected && <ProductDetails product={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
