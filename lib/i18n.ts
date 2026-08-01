/**
 * Every user-facing string in the patient experience, in one place.
 *
 * These used to live as ~115 inline `rtl ? "..." : "..."` ternaries spread
 * across four components, which meant no one could review or edit the Arabic
 * without reading JSX. `ar` is typed against `en`, so a missing translation is
 * a compile error rather than a sentence that silently renders in English.
 */

export type Language = "en" | "ar";

const en = {
  intlLocale: "en-GB",

  brandName: "ASHRAF METWALLY",
  brandRole: "PLASTIC SURGERY",
  homeLabel: "Dr. Ashraf Metwally home",

  nav: ["Expertise", "CareLens", "Journey", "Locations"],
  book: "Reserve a visit",
  languageSwitch: "Switch to Arabic",
  languageShort: "عربي",
  replay: "REPLAY",
  replayLabel: "Replay introduction",
  openMenu: "Open menu",
  closeMenu: "Close menu",

  eyebrow: "Consultant Plastic Surgeon · Cairo",
  titleA: "Aesthetic care,",
  titleB: "designed around you.",
  intro:
    "Precision-led plastic surgery with an experience that begins long before the consultation.",
  ask: "Ask NOOR",
  designJourney: "Design my journey",
  trust: "FRCS · EBOPRAS · Over 25 years of surgical experience",
  heroDate: "Live availability",
  heroAvailabilityLoading: "Checking times…",
  heroAvailabilityEmpty: "Call for the next opening",
  viewAvailability: "View live appointment availability",
  signature: "Dr. Ashraf Metwally",
  signatureRole: "Consultant Plastic Surgeon",
  scrollToDiscover: "SCROLL TO DISCOVER",

  portalLabel: "Explore the experience",
  portalKicker: "SCROLL INTO THE EXPERIENCE",
  portalTitle: "Care, reimagined.",
  portalOneTitle: "Don’t start with a procedure.",
  portalOneEm: "Start with how you want to feel.",
  portalOneBody:
    "A visual discovery tool that turns feelings and goals into a clearer clinical conversation.",
  portalOneAction: "Try CareLens",
  portalTwoTitle: "Ask the question you keep thinking about.",
  portalTwoEm: "Privately. Without judgement.",
  portalTwoBody: "NOOR explains options, preparation, and recovery in Arabic or English.",
  portalTwoAction: "Talk to NOOR",
  portalThreeTitle: "See real availability.",
  portalThreeEm: "Reserve in seconds.",
  portalThreeBody:
    "Choose a clinic and time; the system protects your slot while you complete the details.",
  portalThreeAction: "View live times",
  portalFootnote: "ONE CONNECTED EXPERIENCE",

  proofTitle: "Natural results. Clinical precision.",
  proofBody:
    "Every treatment plan starts with listening, rigorous assessment, and a shared definition of what feels right for you.",
  statYears: "Years of experience",
  statClinics: "Cairo locations",
  statJourney: "Connected care journey",

  careLensKicker: "Introducing CareLens",
  careLensTitle: "Start with what you feel, not a procedure name.",
  careLensBody:
    "Choose an area and discover the questions, options, and recovery considerations worth discussing in consultation.",

  noorKicker: "NOOR AI CONCIERGE",
  noorTitle: "Ask. Understand. Then decide.",
  noorBody:
    "NOOR helps you explore options, understand preparation and recovery, and reach the right consultation — in Arabic or English.",
  noorPrompts: [
    "What is rhinoplasty recovery like?",
    "Show me the next appointment",
    "How should I prepare?",
  ],
  aiDisclaimer: "Educational guidance only — never a diagnosis.",

  journeyKicker: "Your care journey",
  journeyTitle: "Clarity at every stage.",
  journeyBody:
    "From your first question to long-term follow-up, every touchpoint is designed to feel calm, personal, and informed.",

  locationsKicker: "Where to find us",
  locationsTitle: "Three clinics across Cairo.",
  locationsBody:
    "Choose the location that fits your week. Each one runs the same consultation standard and the same connected follow-up.",
  directions: "Get directions",
  openInMaps: "Open in Google Maps",
  consultingHours: "Consultation times",

  finalKicker: "BEGIN YOUR JOURNEY",
  finalTitle: "Your questions deserve a thoughtful answer.",
  finalBody:
    "Meet Dr. Ashraf and leave with a plan built around your anatomy, priorities, and pace.",
  designYourJourney: "Design your journey",

  callClinic: "Call clinic",
  clinicOs: "Clinic OS",
  staffSignIn: "Staff sign-in",
  privacy: "Privacy",
  terms: "Terms",
  footerLocations: "Maadi · Mohandessin · Fifth Settlement",

  floatingKicker: "AI CONCIERGE",
  floatingAction: "Ask NOOR",
  floatingAria: "Ask NOOR, the AI concierge",

  // NOOR panel
  noorPanelLabel: "NOOR, the AI concierge",
  noorGreeting:
    "Hello, I’m NOOR. I can help you understand options, preparation, recovery, or find a suitable appointment. What’s on your mind?",
  noorOnline: "Guided answers",
  noorClose: "Close NOOR",
  noorToday: "TODAY",
  noorQuickNext: "Next appointment",
  noorQuickPrepare: "Prepare",
  noorQuickTimes: "View times",
  noorAskNext: "What is the next available time?",
  noorAskPrepare: "How should I prepare?",
  noorPlaceholder: "Ask anything about your care...",
  noorSpeak: "Speak",
  noorSend: "Send",
  noorListen: "Listen to the last answer",
  noorLegal: "Educational guidance only. Urgent concerns require direct medical care.",
  noorNoVoice: "Voice listening is not available in this browser, but you can type your question here.",
  noorAnswers: {
    booking:
      "I can show live availability in Maadi, Mohandessin, or Fifth Settlement now. Select “View times” and I’ll take you there.",
    nose: "In a rhinoplasty consultation, Dr. Ashraf considers facial balance, breathing, skin thickness, and expectations together. Early swelling and bruising commonly ease over the first weeks, while refinement continues longer. Your exact plan requires an in-person assessment.",
    recovery:
      "Recovery depends on the procedure, your health, and your daily routine. Before scheduling, we’ll clarify time away from work, wound care, follow-up, movement, and when to contact the clinic.",
    cost: "Cost is confirmed after assessment because it depends on the plan, facility, anaesthesia, and follow-up. I can reserve a consultation so you receive a clear, itemised proposal.",
    prepare:
      "Bring your goals, questions, medical history, medication list, and optional reference images. Most importantly, be clear about what you want to feel different—and what you do not want changed.",
    location:
      "The clinic runs in Maadi, Mohandessin, and Fifth Settlement. Each location links straight to Google Maps from the Locations section, so you can open directions on your phone.",
    fallback:
      "I understand. A useful next step is to name the area or change you’re considering, and I’ll explain what can be explored in consultation without assuming a diagnosis. Is this about the face, nose, body, or recovery?",
  },

  // Booking
  bookingStepLabel: "LIVE BOOKING",
  bookingTitle: "Choose a time that fits.",
  bookingSuccessTitle: "Your visit is reserved.",
  bookingClose: "Close booking",
  consultationType: "Consultation type",
  clinic: "Clinic",
  availableTimes: "Available times",
  live: "Live",
  refreshing: "Refreshing",
  noTimesToday: "No times left on this day. Try another day or clinic.",
  loadFailed: "We could not load live availability right now.",
  tryAgain: "Try again",
  callTheClinic: "Call the clinic",
  holdNotice: "Your time is held for 5 minutes while you complete the details.",
  continue: "Continue",
  holding: "Holding...",
  heldFor: (countdown: string) => `This time is held for you for ${countdown}`,
  holdExpired: "Your held time expired. Please choose a new time.",
  fullName: "Full name",
  yourName: "Your name",
  mobileNumber: "Mobile number",
  emailOptional: "Email (optional)",
  noteOptional: "Anything the clinic should know? (optional)",
  notePlaceholder: "A question, a preferred contact time, accessibility needs…",
  consentLabel: "I agree to be contacted by the clinic to confirm my appointment.",
  back: "Back",
  confirmAppointment: "Confirm appointment",
  confirming: "Confirming...",
  addToCalendar: "Add to calendar",
  done: "Done",
  at: "at",
  bookingSuccessBody: (branch: string) =>
    `Your ${branch} visit is in the calendar. The clinic team will contact you to confirm the details.`,
  manageBooking: "Manage this booking",
  selectDateFirst: "Select a day, then a time.",
} satisfies Record<string, unknown>;

const ar: typeof en = {
  intlLocale: "ar-EG",

  brandName: "د. أشرف متولي",
  brandRole: "جراحات التجميل",
  homeLabel: "الصفحة الرئيسية د. أشرف متولي",

  nav: ["الخبرات", "كير لِنز", "رحلتك", "الفروع"],
  book: "احجز زيارتك",
  languageSwitch: "التبديل إلى الإنجليزية",
  languageShort: "EN",
  replay: "المقدمة",
  replayLabel: "أعد تشغيل المقدمة",
  openMenu: "افتح القائمة",
  closeMenu: "أغلق القائمة",

  eyebrow: "استشاري جراحات التجميل · القاهرة",
  titleA: "رعاية تجميلية،",
  titleB: "مصممة خصيصاً لك.",
  intro: "دقة جراحية وخبرة إنسانية تبدأ قبل الاستشارة وتستمر بعدها.",
  ask: "اسأل نور",
  designJourney: "صمّم رحلتك",
  trust: "زمالة الكلية الملكية · البورد الأوروبي · أكثر من ٢٥ عاماً من الخبرة",
  heroDate: "مواعيد متاحة الآن",
  heroAvailabilityLoading: "جاري التحقق من المواعيد…",
  heroAvailabilityEmpty: "اتصل لمعرفة أقرب موعد",
  viewAvailability: "اعرض المواعيد المتاحة",
  signature: "د. أشرف متولي",
  signatureRole: "استشاري جراحات التجميل",
  scrollToDiscover: "مرّر لاكتشاف المزيد",

  portalLabel: "استكشف التجربة",
  portalKicker: "مرّر لاكتشاف التجربة",
  portalTitle: "الرعاية، بشكل مختلف.",
  portalOneTitle: "لا تبدأ باسم الإجراء.",
  portalOneEm: "ابدأ بما تريد أن تشعر به.",
  portalOneBody: "تجربة بصرية تحوّل إحساسك وأهدافك إلى حوار طبي أوضح.",
  portalOneAction: "جرّب كير لِنز",
  portalTwoTitle: "اسأل السؤال الذي يشغلك.",
  portalTwoEm: "بخصوصية. وبدون أحكام.",
  portalTwoBody: "نور تشرح الخيارات والاستعداد والتعافي بالعربية أو الإنجليزية.",
  portalTwoAction: "تحدث مع نور",
  portalThreeTitle: "شاهد المواعيد الحقيقية.",
  portalThreeEm: "واحجز خلال ثوانٍ.",
  portalThreeBody:
    "اختر الفرع والموعد، وسيحتفظ النظام بالوقت أثناء إكمال بياناتك.",
  portalThreeAction: "اعرض المواعيد الآن",
  portalFootnote: "تجربة رقمية متصلة",

  proofTitle: "نتائج طبيعية. دقة طبية.",
  proofBody:
    "كل خطة علاج تبدأ بالاستماع والتقييم الدقيق والاتفاق على النتيجة الأنسب لك.",
  statYears: "عاماً من الخبرة",
  statClinics: "عيادات في القاهرة",
  statJourney: "رحلة رعاية متكاملة",

  careLensKicker: "نقدم لك كير لِنز",
  careLensTitle: "ابدأ بما تشعر به، وليس باسم الإجراء.",
  careLensBody:
    "اختر المنطقة واكتشف الأسئلة والخيارات وتفاصيل التعافي التي تستحق النقاش أثناء الاستشارة.",

  noorKicker: "نور — المساعدة الذكية",
  noorTitle: "اسأل، افهم، ثم قرر.",
  noorBody:
    "نور تساعدك على استكشاف الخيارات، فهم الاستعداد والتعافي، والوصول للاستشارة المناسبة — بالعربية أو الإنجليزية.",
  noorPrompts: ["ماذا أتوقع بعد تجميل الأنف؟", "ما أقرب موعد؟", "كيف أستعد للاستشارة؟"],
  aiDisclaimer: "معلومات تثقيفية فقط — وليست تشخيصاً طبياً.",

  journeyKicker: "رحلة رعايتك",
  journeyTitle: "وضوح في كل خطوة.",
  journeyBody:
    "من أول سؤال وحتى المتابعة، صممنا كل لحظة لتكون هادئة وشخصية ومدروسة.",

  locationsKicker: "أين تجدنا",
  locationsTitle: "ثلاث عيادات في القاهرة.",
  locationsBody:
    "اختر الفرع الأنسب لجدولك. جميع الفروع بنفس مستوى الاستشارة ونفس المتابعة المتصلة.",
  directions: "احصل على الاتجاهات",
  openInMaps: "افتح في خرائط جوجل",
  consultingHours: "مواعيد الاستشارات",

  finalKicker: "ابدأ رحلتك",
  finalTitle: "أسئلتك تستحق إجابة مدروسة.",
  finalBody: "قابل د. أشرف واخرج بخطة تناسب تكوينك وأولوياتك والوقت المناسب لك.",
  designYourJourney: "صمّم رحلتك",

  callClinic: "اتصل بالعيادة",
  clinicOs: "نظام العيادة",
  staffSignIn: "دخول الفريق",
  privacy: "الخصوصية",
  terms: "الشروط",
  footerLocations: "المعادي · المهندسين · التجمع الخامس",

  floatingKicker: "مساعدة ذكية",
  floatingAction: "اسأل نور",
  floatingAria: "اسأل نور، المساعدة الذكية",

  noorPanelLabel: "نور، المساعدة الذكية",
  noorGreeting:
    "أهلاً، أنا نور. أستطيع مساعدتك في فهم الخيارات، الاستعداد، التعافي أو العثور على موعد مناسب. ما الذي يشغل بالك؟",
  noorOnline: "إجابات مُعدة مسبقاً",
  noorClose: "إغلاق نور",
  noorToday: "اليوم",
  noorQuickNext: "أقرب موعد",
  noorQuickPrepare: "الاستعداد",
  noorQuickTimes: "عرض المواعيد",
  noorAskNext: "ما أقرب موعد؟",
  noorAskPrepare: "كيف أستعد؟",
  noorPlaceholder: "اكتب سؤالك هنا...",
  noorSpeak: "تحدث",
  noorSend: "إرسال",
  noorListen: "استمع لآخر إجابة",
  noorLegal: "معلومات تثقيفية فقط. الحالات العاجلة تحتاج تواصلاً طبياً مباشراً.",
  noorNoVoice: "الاستماع الصوتي غير متاح في هذا المتصفح، لكن يمكنك كتابة سؤالك هنا.",
  noorAnswers: {
    booking:
      "أستطيع عرض المواعيد المتاحة الآن في المعادي أو المهندسين أو التجمع. اضغط «عرض المواعيد» وسأكمل معك.",
    nose: "في استشارة تجميل الأنف، يقيّم د. أشرف التناسق والتنفس وسُمك الجلد والتوقعات معاً. يختلف التعافي من شخص لآخر، لكن التورم والكدمات الأولية غالباً تتحسن تدريجياً خلال الأسابيع الأولى. القرار النهائي يحتاج كشفاً طبياً.",
    recovery:
      "مدة التعافي تعتمد على الإجراء وصحتك وطبيعة عملك. سنناقش العودة للنشاط، العناية بالجرح، المتابعة والعلامات التي تستدعي التواصل قبل تحديد الموعد.",
    cost: "التكلفة تتحدد بعد التقييم لأنها تعتمد على الخطة، المستشفى، التخدير والمتابعة. يمكنني حجز استشارة تحصل بعدها على عرض واضح ومفصل.",
    prepare:
      "اكتب أهدافك وأسئلتك، وأحضر تاريخك الطبي وقائمة الأدوية وصوراً مرجعية إن وجدت. الأهم أن تكون واضحاً بشأن النتيجة التي تريدها وما لا تريده.",
    location:
      "العيادة تعمل في المعادي والمهندسين والتجمع الخامس. كل فرع مرتبط مباشرة بخرائط جوجل من قسم «الفروع»، لتفتح الاتجاهات من هاتفك.",
    fallback:
      "أفهمك. أفضل خطوة هي تحديد المنطقة أو الهدف الذي تفكر فيه، ثم أشرح لك ما يمكن مناقشته في الاستشارة بدون افتراض تشخيص. هل تسأل عن الوجه، الأنف، القوام أم التعافي؟",
  },

  bookingStepLabel: "الحجز المباشر",
  bookingTitle: "اختر الموعد المناسب.",
  bookingSuccessTitle: "تم حجز زيارتك.",
  bookingClose: "إغلاق الحجز",
  consultationType: "نوع الاستشارة",
  clinic: "الفرع",
  availableTimes: "المواعيد المتاحة",
  live: "مباشر",
  refreshing: "جاري التحديث",
  noTimesToday: "لا توجد مواعيد متاحة في هذا اليوم. جرّب يوماً أو فرعاً آخر.",
  loadFailed: "تعذر تحميل المواعيد المتاحة الآن.",
  tryAgain: "إعادة المحاولة",
  callTheClinic: "اتصل بالعيادة",
  holdNotice: "يُحفظ الموعد لمدة ٥ دقائق أثناء إكمال البيانات.",
  continue: "متابعة",
  holding: "لحظة...",
  heldFor: (countdown: string) => `هذا الموعد محجوز لك لمدة ${countdown}`,
  holdExpired: "انتهت مدة حجز الموعد المؤقت. اختر وقتاً جديداً.",
  fullName: "الاسم بالكامل",
  yourName: "اكتب اسمك",
  mobileNumber: "رقم الهاتف",
  emailOptional: "البريد الإلكتروني (اختياري)",
  noteOptional: "هل هناك ما تود إخبار العيادة به؟ (اختياري)",
  notePlaceholder: "سؤال، وقت تواصل مفضل، أو احتياجات خاصة…",
  consentLabel: "أوافق على تواصل العيادة لتأكيد الموعد.",
  back: "العودة",
  confirmAppointment: "تأكيد الموعد",
  confirming: "جاري التأكيد...",
  addToCalendar: "أضف إلى التقويم",
  done: "تم",
  at: "الساعة",
  bookingSuccessBody: (branch: string) =>
    `تم حجز الموعد في فرع ${branch}. سيتواصل معك فريق العيادة لتأكيد التفاصيل.`,
  manageBooking: "إدارة هذا الحجز",
  selectDateFirst: "اختر يوماً، ثم اختر الوقت.",
};

export const dictionary: Record<Language, typeof en> = { en, ar };

export type Copy = typeof en;

export function copyFor(language: Language): Copy {
  return dictionary[language];
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ar";
}

export function directionFor(language: Language): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}

/**
 * The canonical URL for each language. English is the site root, so the most
 * linked-to address stays unchanged and needs no redirect hop.
 *
 * Single source of truth on purpose: the layouts, the language switch, the
 * canonical tag and the sitemap all read from here, and any two of them
 * disagreeing would tell Google the pages are duplicates.
 */
export const LOCALE_PATH: Record<Language, string> = {
  en: "/",
  ar: "/ar",
};

export const LANGUAGES: Language[] = ["en", "ar"];

/** The language a visitor switches to from the one they are reading. */
export function otherLanguage(language: Language): Language {
  return language === "ar" ? "en" : "ar";
}
