'use client';

import { useEffect } from 'react';
import * as CookieConsentLib from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

function loadGA(gaId: string) {
  if (document.getElementById('_ga_script')) return;

  window.dataLayer = window.dataLayer || [];
  // Standard gtag shim — must use `arguments` (not rest params)
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', gaId, { anonymize_ip: true });

  const script = document.createElement('script');
  script.id = '_ga_script';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  script.async = true;
  document.head.appendChild(script);
}

function buildTranslations(hostname: string): Record<string, CookieConsentLib.Translation> {
  return {
    en: {
      consentModal: {
        title: 'We use cookies',
        description:
          'We use essential cookies to keep the site working. With your permission, we also use analytics cookies (Google Analytics) to understand how visitors use our site — no personal data is sold or shared.',
        acceptAllBtn: 'Accept all',
        acceptNecessaryBtn: 'Reject all',
        showPreferencesBtn: 'Manage preferences',
        footer:
          '<a href="https://coder.churrostack.com/en/privacy" class="cc__link">Privacy Policy</a> · <a href="https://coder.churrostack.com/en/cookies" class="cc__link">Cookie Policy</a>',
      },
      preferencesModal: {
        title: 'Cookie preferences',
        acceptAllBtn: 'Accept all',
        acceptNecessaryBtn: 'Reject all',
        savePreferencesBtn: 'Save preferences',
        closeIconLabel: 'Close',
        serviceCounterLabel: 'Service|Services',
        sections: [
          {
            title: 'Your privacy choices',
            description:
              'You can choose which optional cookies to allow. Essential cookies are always active because the site cannot function without them. You can change these preferences at any time.',
          },
          {
            title: 'Strictly necessary',
            description:
              'These cookies are required for core functionality (e.g. remembering your cookie choice). They cannot be disabled.',
            linkedCategory: 'necessary',
          },
          {
            title: 'Analytics',
            description:
              'These cookies help us understand how visitors interact with our site. All data is aggregated and anonymised. We use Google Analytics with IP anonymisation enabled.',
            linkedCategory: 'analytics',
            cookieTable: {
              caption: 'Google Analytics cookies',
              headers: {
                name: 'Cookie',
                domain: 'Domain',
                desc: 'Purpose',
                expiration: 'Expiry',
              },
              body: [
                {
                  name: '_ga',
                  domain: hostname,
                  desc: 'Distinguishes unique users by assigning a random ID.',
                  expiration: '2 years',
                },
                {
                  name: '_ga_*',
                  domain: hostname,
                  desc: 'Stores and counts page views.',
                  expiration: '2 years',
                },
              ],
            },
          },
          {
            title: 'More information',
            description:
              'For any questions about our cookie policy, please <a class="cc__link" href="mailto:hello@churrostack.com">contact us</a>.',
          },
        ],
      },
    },
    es: {
      consentModal: {
        title: 'Usamos cookies',
        description:
          'Usamos cookies esenciales para que el sitio funcione. Con tu permiso, también usamos cookies de analítica (Google Analytics) para entender cómo los visitantes usan nuestro sitio — no se venden ni comparten datos personales.',
        acceptAllBtn: 'Aceptar todas',
        acceptNecessaryBtn: 'Rechazar todas',
        showPreferencesBtn: 'Gestionar preferencias',
        footer:
          '<a href="https://coder.churrostack.com/es/privacy" class="cc__link">Política de privacidad</a> · <a href="https://coder.churrostack.com/es/cookies" class="cc__link">Política de cookies</a>',
      },
      preferencesModal: {
        title: 'Preferencias de cookies',
        acceptAllBtn: 'Aceptar todas',
        acceptNecessaryBtn: 'Rechazar todas',
        savePreferencesBtn: 'Guardar preferencias',
        closeIconLabel: 'Cerrar',
        serviceCounterLabel: 'Servicio|Servicios',
        sections: [
          {
            title: 'Tus opciones de privacidad',
            description:
              'Puedes elegir qué cookies opcionales permitir. Las cookies esenciales siempre están activas porque el sitio no puede funcionar sin ellas. Puedes cambiar estas preferencias en cualquier momento.',
          },
          {
            title: 'Estrictamente necesarias',
            description:
              'Estas cookies son necesarias para la funcionalidad básica (por ejemplo, recordar tu elección de cookies). No pueden desactivarse.',
            linkedCategory: 'necessary',
          },
          {
            title: 'Analítica',
            description:
              'Estas cookies nos ayudan a entender cómo los visitantes interactúan con nuestro sitio. Todos los datos son agregados y anonimizados. Usamos Google Analytics con anonimización de IP activada.',
            linkedCategory: 'analytics',
            cookieTable: {
              caption: 'Cookies de Google Analytics',
              headers: {
                name: 'Cookie',
                domain: 'Dominio',
                desc: 'Propósito',
                expiration: 'Caducidad',
              },
              body: [
                {
                  name: '_ga',
                  domain: hostname,
                  desc: 'Distingue usuarios únicos asignando un ID aleatorio.',
                  expiration: '2 años',
                },
                {
                  name: '_ga_*',
                  domain: hostname,
                  desc: 'Almacena y cuenta las páginas vistas.',
                  expiration: '2 años',
                },
              ],
            },
          },
          {
            title: 'Más información',
            description:
              'Para cualquier pregunta sobre nuestra política de cookies, <a class="cc__link" href="mailto:hello@churrostack.com">contáctanos</a>.',
          },
        ],
      },
    },
  };
}

interface CookieConsentProps {
  locale: string;
  gaId?: string;
}

export default function CookieConsent({ locale, gaId }: CookieConsentProps) {
  useEffect(() => {
    const lang = locale === 'es' ? 'es' : 'en';

    CookieConsentLib.run({
      guiOptions: {
        consentModal: {
          layout: 'box',
          position: 'bottom left',
          equalWeightButtons: true,
          flipButtons: false,
        },
        preferencesModal: {
          layout: 'box',
          equalWeightButtons: true,
          flipButtons: false,
        },
      },
      categories: {
        necessary: {
          enabled: true,
          readOnly: true,
        },
        analytics: {
          enabled: false,
          autoClear: {
            cookies: [
              { name: /^(_ga|_gid|_gat)/ },
            ],
          },
        },
      },
      language: {
        default: lang,
        translations: buildTranslations(window.location.hostname),
      },
      onConsent: () => {
        if (gaId && CookieConsentLib.acceptedCategory('analytics')) {
          loadGA(gaId);
        }
      },
      onChange: ({ changedCategories }) => {
        if (changedCategories.includes('analytics')) {
          if (gaId && CookieConsentLib.acceptedCategory('analytics')) {
            loadGA(gaId);
          }
        }
      },
    });
  // run once per mount; locale/gaId are stable after hydration
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
