import { Link } from 'react-router-dom';
import { FileText, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { inr } from '../lib/format.js';

const terms = [
  {
    title: 'About these terms',
    body: [
      'These terms govern every self-drive rental booked through Rove Mobility Pvt. Ltd. (“Rove”, “we”, “us”). By booking a vehicle you accept them in full, both for yourself and for any additional driver you register.',
      'We keep the driving experience simple, but the legal parts matter. If anything here is unclear, email hello@rove.rent before you pay.',
    ],
  },
  {
    id: 'licence',
    title: 'Eligibility, licence and age rules',
    body: [
      'The lead driver must be at least 21 years old and hold a full Indian driving licence, or a valid international driving permit together with a licence from their home country, held for at least 12 months.',
      'You must present the original licence and a government-issued photo ID at pick-up. Photocopies, expired licences and digital-only copies are not accepted at the hub.',
      'Additional drivers must be registered and verified before pick-up. Only registered drivers may operate the vehicle. Drivers over 85 require prior written approval.',
      'We may decline a rental or terminate it early if documents cannot be verified, if the driver appears intoxicated, or if we reasonably believe the vehicle will be used unlawfully.',
    ],
  },
  {
    title: 'Booking and confirmation',
    body: [
      'Availability shown on the site is live. A booking is confirmed only when payment or the agreed deposit is captured and you receive a booking code beginning “RV-”.',
      'Your voucher, rental contract and GST invoice are generated for the email used at checkout and are available to download from the confirmation page. Please check the vehicle, dates, hub and driver details immediately and tell us about any error.',
      'We may substitute a vehicle of equal or higher category if the reserved vehicle becomes unavailable due to a mechanical issue. You may decline the substitution for a full refund.',
    ],
  },
  {
    title: 'Payment, deposits, taxes and refunds',
    body: [
      'All prices are quoted in Indian Rupees and include GST at the prevailing rate. The total shown at checkout is the total you are billed for the rental.',
      'You may pay in full or reserve with a 25% deposit. Where a deposit is paid, the balance is due at pick-up before the keys are handed over.',
      'A refundable security deposit of ₹5,000 is due at pick-up to cover tolls, traffic fines, fuel differences and minor cleaning. It is not part of the online rental charge and is returned within 5–7 working days of drop-off, less any deductions that apply.',
      'Payments are processed by Razorpay. We never store your full card number; we retain only the card brand and last four digits.',
    ],
  },
  {
    title: 'Cancellation and changes',
    body: [
      'Cancel at least 48 hours before your scheduled pick-up for a full refund of the rental amount. Cancel inside 48 hours and 50% is refunded.',
      'Date and vehicle changes are free, subject to availability. Any difference in fare is charged or refunded accordingly. Changes are not possible once the rental has started.',
      'Security deposits are returned in full on cancellation, less any applicable cancellation charge.',
      'If we cancel for reasons within our control — for example a vehicle fault with no replacement — you receive a full refund, and we will help arrange an alternative where we can.',
    ],
  },
  {
    title: 'Fuel, charging and mileage',
    body: [
      'Petrol and diesel vehicles are handed over with a full tank and must be returned full. If you return the vehicle with less fuel, we charge the missing fuel at the prevailing pump rate plus a ₹300 refuelling fee.',
      'Electric vehicles are handed over at 90% charge or above and should be returned with at least 20% charge. Charging costs during the rental are your responsibility; a nominal handling fee applies if the vehicle returns below 20%.',
      'Each vehicle shows its included daily kilometres on the vehicle page and at checkout. Where no allowance is shown, kilometres are unlimited within India. Distance beyond an allowance is billed at the rate shown at checkout and settled at drop-off. Cross-border travel is not permitted without prior written approval.',
    ],
  },
  {
    id: 'damage',
    title: 'Damage, insurance and liability',
    body: [
      'Every rental includes the protection tier you selected at checkout. Basic protection carries a deductible of ₹75,000, Standard ₹20,000 and Full coverage ₹0 (zero deductible, glass and tyre cover included).',
      'You remain responsible for damage caused by negligence, driving under the influence, unauthorised drivers, off-road use in vehicles not designed for it, or use in the commission of an offence. Insurance may be void in those circumstances.',
      'Traffic fines, parking penalties and tolls incurred during the rental are your responsibility and may be charged to the card on file. We pass them on at cost, with the official receipt.',
      'Lost keys, missing accessories, smoking, or interior damage requiring specialist cleaning are chargeable at published rates, which we will always share before charging.',
      'This damage disclaimer does not limit any rights you have that cannot be limited under applicable Indian law.',
    ],
  },
  {
    title: 'Prohibited use',
    body: [
      'The vehicle may not be used for hire or reward, racing, track days, towing (unless the vehicle is fitted with a tow package), driving instruction, or any unlawful purpose.',
      'Smoking, vaping and transporting pets in vehicles not designated pet-friendly is not permitted. A cleaning fee applies.',
      'You may not sub-let the vehicle or allow anyone other than a registered driver to operate it.',
    ],
  },
  {
    title: 'One-way rentals and delivery',
    body: [
      'One-way rentals between our hubs carry a relocation fee of ₹1,500, shown in checkout before payment.',
      'Doorstep delivery and collection is available in most cities for a fee confirmed at booking. Delivery is subject to an address check and driver availability.',
    ],
  },
  {
    title: 'Governing law and complaints',
    body: [
      'These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts of Bengaluru, Karnataka.',
      'If something goes wrong, please contact us first at hello@rove.rent or on +91 80 5555 0100. We aim to resolve every complaint within five working days.',
      'Rove Mobility Pvt. Ltd. · GSTIN 29AABCR1234F1Z5 · Last updated 1 October 2026.',
    ],
  },
];

const privacy = [
  {
    title: 'Overview',
    body: [
      'Rove Mobility Pvt. Ltd. is the data controller for the personal information described in this policy. We collect the minimum needed to rent you a vehicle safely and to meet our legal obligations.',
      'This policy explains what we collect, why, how long we keep it and the choices you have. It applies to rove.rent and to bookings made at our hubs.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      'Account and identity data: your name, email address, phone number, date of birth, driving licence number and, at pick-up, a copy or record of your licence and photo ID.',
      'Booking data: vehicles, dates, hubs, extras, insurance choices, driver details, notes you add and the resulting contract, voucher and invoice.',
      'Payment data: the amount, status and reference for each transaction, together with the card brand and last four digits. Full card details are handled by Razorpay and never reach our servers.',
      'Technical data: IP address, device and browser type, and pages visited, collected through cookies and similar technologies.',
    ],
  },
  {
    title: 'How we use it',
    body: [
      'To create and manage your account, verify eligibility, prepare contracts, hand over vehicles and provide support.',
      'To process payments, refunds and security deposits through Razorpay, and to meet tax and accounting requirements.',
      'To make booking confirmations, vouchers, contracts and invoices available to you, and — where you have opted in — to share occasional offers you can unsubscribe from at any time.',
      'To detect and prevent fraud, verify documents and comply with lawful requests from authorities.',
    ],
  },
  {
    title: 'Payments and Razorpay',
    body: [
      'Card, UPI and net-banking payments are processed by Razorpay, a PCI-DSS compliant payment gateway. When you pay, the payment details you enter are provided directly to Razorpay.',
      'We receive confirmation that a payment succeeded, the amount, the method type, and the brand and last four digits of the card, so we can show your transaction history and process refunds.',
      'Refunds are sent back to the original payment method. Timing depends on your bank, typically 5–7 working days.',
    ],
  },
  {
    title: 'When we share information',
    body: [
      'With service providers who help us operate: Razorpay for payments, our cloud hosting and database provider for storage, and our email provider for account and password-reset messages. They act on our instructions.',
      'With insurers and roadside-assistance partners where a claim or breakdown occurs.',
      'With law enforcement or regulators where we are legally required to do so, or to protect the rights and safety of Rove, our customers and the public.',
      'We never sell your personal information.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'Booking, invoice and payment records are kept for eight years to satisfy Indian tax and accounting rules.',
      'Licence and identity records are kept only as long as needed to verify eligibility and to resolve any dispute arising from the rental, then securely deleted.',
      'Marketing preferences are kept until you unsubscribe or ask us to delete your account.',
    ],
  },
  {
    title: 'Your rights',
    body: [
      'You may request a copy of the personal data we hold about you, ask us to correct inaccuracies, or ask us to delete data we no longer need to keep.',
      'You can update most details yourself from your account page. For anything else, email hello@rove.rent and we will respond within 30 days.',
      'You can opt out of marketing messages at any time using the unsubscribe link or by contacting us. Transactional information about an active booking remains available in your account.',
    ],
  },
  {
    title: 'Cookies',
    body: [
      'We use essential browser storage and cookies to keep you signed in, secure your session and remember booking progress. We do not run third-party advertising cookies.',
      'You can control cookies and site storage through your browser settings. Blocking essential storage may prevent sign-in or checkout from working correctly.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Data is encrypted in transit and at rest. Access to customer records is restricted to staff who need it to perform their role.',
      'If a breach ever affects your personal data, we will notify you and the relevant authority as required by law.',
    ],
  },
  {
    title: 'Contact us',
    body: [
      'Questions about privacy? Email hello@rove.rent or write to the Data Protection Officer, Rove Mobility Pvt. Ltd., Indiranagar, Bengaluru 560038, Karnataka, India.',
      'Last updated 1 October 2026.',
    ],
  },
];

function localiseSections(source, content, isTerms, insuranceTiers = []) {
  const policy = content.policy;
  return source.map((section) => ({
    ...section,
    body: section.body.map((paragraph) => {
      let next = paragraph
        .replace(/Rove Mobility Pvt\. Ltd\./g, content.company_legal_name)
        .replace(/hello@rove\.rent/g, content.support_email)
        .replace(/\+91 80 5555 0100/g, content.support_phone)
        .replace(/ · GSTIN 29AABCR1234F1Z5/g, content.gstin ? ` · GSTIN ${content.gstin}` : '')
        .replace(/Last updated 1 October 2026\.?/g, `Last updated ${content.legal_updated}.`)
        .replace(/Indiranagar, Bengaluru 560038, Karnataka, India/g, content.registered_address);
      if (isTerms) {
        const taxLabel = String(content.tax_label || 'GST').trim() || 'GST';
        next = next.replace(/GST invoice/g, `${taxLabel} invoice`);
        next = next.replace(
          'All prices are quoted in Indian Rupees and include GST at the prevailing rate. The total shown at checkout is the total you are billed for the rental.',
          content.tax_inclusive === true || content.tax_inclusive === 'true'
            ? `All prices are quoted in Indian Rupees and include ${taxLabel} at the prevailing rate. The total shown at checkout is the total you are billed for the rental.`
            : `All prices are quoted in Indian Rupees. ${taxLabel} at the prevailing rate is added at checkout, and the total shown there is the total you are billed for the rental.`,
        );
        if (insuranceTiers.length) {
          const protection = insuranceTiers.map((tier) => {
            const deductible = Number(tier.deductible) || 0;
            return `${tier.label} ${deductible > 0
              ? `carries a deductible of ${inr(deductible)}`
              : 'has zero deductible'}`;
          });
          const sentence = protection.length > 1
            ? `${protection.slice(0, -1).join(', ')} and ${protection.at(-1)}.`
            : `${protection[0]}.`;
          next = next.replace(
            'Basic protection carries a deductible of ₹75,000, Standard ₹20,000 and Full coverage ₹0 (zero deductible, glass and tyre cover included).',
            sentence,
          );
        }
        next = next
          .replace(/at least 21 years old/g, `at least ${policy.minAge} years old`)
          .replace(/48 hours/g, policy.windowLabel)
          .replace(/50% is refunded/g, `${policy.refundPercent}% is refunded`)
          .replace(/₹5,000/g, inr(policy.holdAmount))
          .replace(/25% deposit/g, `${policy.depositPercent}% deposit`)
          .replace(/₹1,500/g, inr(policy.oneWayFee))
          .replace(/₹300/g, inr(policy.fuelFee));
        if (content.bikes_enabled) {
          next = next.replace(
            /(If you return the vehicle with less fuel, we charge the missing fuel at the prevailing pump rate plus a [^.]+\.)/,
            `$1 Two-wheelers have a ${inr(policy.bikeFuelFee)} refuelling fee.`,
          );
        }
      }
      return next;
    }),
  }));
}

export default function Legal({ kind = 'terms' }) {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const isTerms = kind === 'terms';
  const source = isTerms ? terms : privacy;
  const sections = localiseSections(source, content, isTerms, meta.insuranceTiers ?? []);

  return (
    <div className="pb-20">
      <section className="no-print relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-10 sm:py-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted shadow-sm backdrop-blur-sm">
            {isTerms ? <FileText className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {content.legal_badge}
          </span>
          <h1 className="display mt-4 text-4xl leading-none sm:text-5xl lg:text-[3.6rem]">
            {isTerms ? content.terms_title : content.privacy_title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            {isTerms ? content.terms_description : content.privacy_description}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4 text-[0.68rem] text-muted">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-forest" /> Last updated {content.legal_updated}</span>
            <a href={`mailto:${content.support_email}`} className="inline-flex items-center gap-1.5 font-bold text-forest hover:underline"><Mail className="h-3.5 w-3.5" /> {content.support_email}</a>
          </div>
        </div>
      </section>

      <div className="container-x mt-8 grid gap-10 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-3xl border border-white/80 bg-white/85 p-5 shadow-card backdrop-blur-sm">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-muted">{content.legal_toc_label}</p>
            <nav className="mt-3 space-y-1">
              {sections.map((section, index) => (
                <a
                  key={section.title}
                  href={`#${section.id || slug(section.title)}`}
                  className="block rounded-lg px-2.5 py-1.5 text-[0.72rem] font-semibold text-ink/70 transition hover:bg-lime/20 hover:text-ink"
                >
                  {index + 1}. {section.title}
                </a>
              ))}
            </nav>
            <div className="mt-4 border-t border-line pt-4">
              <Link to={isTerms ? '/privacy' : '/terms'} className="text-[0.7rem] font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">
                {isTerms ? 'Read the privacy policy' : 'Read the rental terms'}
              </Link>
            </div>
          </div>
        </aside>

        <div className="stagger max-w-3xl space-y-4">
          {sections.map((section, index) => (
            <section
              key={section.title}
              id={section.id || slug(section.title)}
              className="scroll-mt-28 rounded-3xl border border-line bg-white/95 p-5 shadow-[0_18px_44px_-42px_rgba(10,15,11,0.5)] transition duration-300 hover:border-ink/20 hover:shadow-card sm:p-7"
            >
              <p className="inline-flex rounded-full bg-gradient-to-r from-lime/35 to-aqua/25 px-2.5 py-1 text-[0.58rem] font-extrabold uppercase tracking-[0.16em] text-forest">Section {String(index + 1).padStart(2, '0')}</p>
              <h2 className="mt-1.5 text-xl font-extrabold tracking-tight sm:text-2xl">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="text-sm leading-7 text-ink/75">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}

          <div className="relative overflow-hidden rounded-3xl border border-lime-deep/40 bg-gradient-to-br from-lime/30 via-lime/15 to-aqua/15 p-5 shadow-[0_20px_50px_-40px_rgba(10,15,11,0.5)] sm:p-6">
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime/30 blur-2xl" />
            <h2 className="relative text-lg font-extrabold tracking-tight">{content.legal_contact_title}</h2>
            <p className="relative mt-1.5 text-sm leading-6 text-ink/70">
              Our team answers {content.support_hours}. Email <a href={`mailto:${content.support_email}`} className="font-bold underline underline-offset-2">{content.support_email}</a> or call
              {' '}<a href={`tel:${content.support_phone ? String(content.support_phone).replace(/[^\d+]/g, '') : ''}`} className="font-bold underline underline-offset-2">{content.support_phone}</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
