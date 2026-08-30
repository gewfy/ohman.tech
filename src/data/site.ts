export const site = {
  name: 'Ohman Mechatronics',
  owner: 'Jakob Öhman',
  city: 'Stockholm',
  tagline: 'Custom machine and robotics builds.',
  description:
    'Ohman Mechatronics — Jakob Öhman, mechatronics engineer in Stockholm. Custom machine and robotics builds, from prototype to production.',
  email: 'jakob@ohman.tech',
  phone: '+46 736 47 18 53',
  phoneHref: 'tel:+46736471853',
  social: {
    github: 'https://github.com/gewfy',
    instagram: 'https://www.instagram.com/jakob.ohman/',
    facebook: 'https://www.facebook.com/jakob.ohman',
    linkedin: 'https://www.linkedin.com/in/jakobohman/'
  },
  practice: {
    text: "Ohman Mechatronics is Jakob Öhman, a mechatronics engineer based in Stockholm, Sweden. I design and build custom machines end to end, from mechanics and electronics to firmware and cloud software, taking machine and robotics projects from prototype to production for artists, researchers and companies.",
    groups: [
      {
        label: 'Design',
        value: 'Machine design, CAD & 3D modelling, PCB design'
      },
      {
        label: 'Fabrication',
        value: 'Prototyping, 3D printing, laser cutting, parts sourcing'
      },
      {
        label: 'Electrical',
        value: 'Control panel building, wiring, variable frequency drives, motor control'
      },
      {
        label: 'Software',
        value: 'Firmware/back-end/web/app-development, AI/LLM/ML, API/cloud integration, live dashboards, sensors and data logging'
      }
    ]
  }
} as const;
