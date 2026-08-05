/**
 * Treatment content, as indexable pages.
 *
 * All of this used to live inside the CareLens 3D scene, which meant it was
 * invisible to search: a crawler saw a canvas element and nothing else. A
 * patient in Cairo searching "تجميل الأنف" or "rhinoplasty Maadi" is the single
 * largest source of demand this practice has, and there was no page to rank.
 *
 * Each entry produces one page per language, cross-linked with hreflang.
 */

import type { Language } from "./i18n";

export type TreatmentFaq = { q: string; a: string };

export type TreatmentCopy = {
  title: string;
  /** Used in <title> and the H1; kept under ~60 chars for search results. */
  metaTitle: string;
  metaDescription: string;
  feeling: string;
  intro: string;
  exploreTitle: string;
  explore: string[];
  recoveryTitle: string;
  recovery: Array<{ label: string; text: string }>;
  optionsTitle: string;
  options: string[];
  faqTitle: string;
  faq: TreatmentFaq[];
};

export type Treatment = {
  slug: string;
  /** Consultation this page books into, so the CTA lands pre-selected. */
  service: string;
  number: string;
  /**
   * Omitted for Dr. Ashraf's own surgical consultations. A named provider keeps
   * another line of care — currently Dentistry — from being presented as a
   * personal service of the plastic surgeon in page copy or structured data.
   */
  provider?: {
    kind: "dental";
    en: string;
    ar: string;
  };
  en: TreatmentCopy;
  ar: TreatmentCopy;
};

export const TREATMENTS: Treatment[] = [
  {
    slug: "face-and-neck",
    service: "face",
    number: "01",
    en: {
      title: "Face & neck",
      metaTitle: "Face & Neck Surgery in Cairo",
      metaDescription:
        "Facial rejuvenation, eyelid surgery and fat grafting with Dr. Ashraf Metwally, Consultant Plastic Surgeon in Maadi, Mohandessin and Fifth Settlement.",
      feeling: "I want to look fresher, without looking different.",
      intro:
        "Facial ageing is rarely one thing. Skin quality, lost volume, muscle support and the underlying proportions all change at different rates, which is why two people the same age can need entirely different plans. A consultation begins by separating those factors rather than assuming a procedure.",
      exploreTitle: "What the consultation covers",
      explore: [
        "Facial proportions and how they have changed",
        "Skin quality and volume assessment",
        "Whether a surgical or non-surgical route fits your goal",
        "Scar placement and realistic recovery planning",
      ],
      recoveryTitle: "How recovery usually unfolds",
      recovery: [
        { label: "Phase 01", text: "Protection and early healing, with swelling at its peak" },
        { label: "Phase 02", text: "Return to a social rhythm as bruising settles" },
        { label: "Phase 03", text: "Progressive refinement over the following months" },
      ],
      optionsTitle: "Options often discussed",
      options: ["Facial rejuvenation", "Eyelid surgery", "Fat grafting", "Neck contouring"],
      faqTitle: "Common questions",
      faq: [
        {
          q: "Will I look like a different person?",
          a: "That is the most common fear, and it is the reason assessment matters more than technique. The aim of a well-planned facial procedure is that people notice you look rested, not that you look operated on.",
        },
        {
          q: "How long before I can return to work?",
          a: "It depends on the procedure and on how public your work is. This is discussed openly in consultation so you can plan around it, rather than discovering it afterwards.",
        },
        {
          q: "Do I need surgery, or would a non-surgical treatment do?",
          a: "Often the honest answer is the non-surgical route, and sometimes it is that neither is needed yet. An assessment should tell you which — including when the answer is to wait.",
        },
      ],
    },
    ar: {
      title: "الوجه والرقبة",
      metaTitle: "جراحات الوجه والرقبة في القاهرة",
      metaDescription:
        "تجديد شباب الوجه، جراحات الجفون وحقن الدهون مع د. أشرف متولي، استشاري جراحات التجميل في المعادي والمهندسين والتجمع الخامس.",
      feeling: "أريد مظهراً أكثر حيوية بدون تغيير ملامحي.",
      intro:
        "تغيّر الوجه مع الوقت ليس عاملاً واحداً. جودة البشرة، فقدان الحجم، دعم العضلات والتناسق الأساسي تتغير بمعدلات مختلفة، ولهذا قد يحتاج شخصان في نفس العمر خطتين مختلفتين تماماً. تبدأ الاستشارة بفصل هذه العوامل بدلاً من افتراض إجراء معيّن.",
      exploreTitle: "ما تشمله الاستشارة",
      explore: [
        "تناسق الوجه وكيف تغيّر مع الوقت",
        "تقييم جودة البشرة والحجم",
        "هل الحل الجراحي أم غير الجراحي هو الأنسب لهدفك",
        "موضع الندبات والتخطيط الواقعي للتعافي",
      ],
      recoveryTitle: "كيف يسير التعافي عادة",
      recovery: [
        { label: "المرحلة ٠١", text: "الحماية والالتئام المبكر مع ذروة التورم" },
        { label: "المرحلة ٠٢", text: "العودة للحياة الاجتماعية مع انحسار الكدمات" },
        { label: "المرحلة ٠٣", text: "تحسن تدريجي خلال الأشهر التالية" },
      ],
      optionsTitle: "خيارات تُناقش عادة",
      options: ["تجديد شباب الوجه", "جراحة الجفون", "حقن الدهون", "تنسيق الرقبة"],
      faqTitle: "أسئلة شائعة",
      faq: [
        {
          q: "هل سأبدو شخصاً مختلفاً؟",
          a: "هذا أكثر ما يقلق المرضى، ولهذا يكون التقييم أهم من التقنية نفسها. هدف أي إجراء مدروس للوجه أن يلاحظ الناس أنك تبدو مرتاحاً، لا أنك خضعت لجراحة.",
        },
        {
          q: "متى أعود إلى العمل؟",
          a: "يعتمد على الإجراء وعلى طبيعة عملك ومدى تعاملك المباشر مع الناس. نناقش ذلك بوضوح في الاستشارة حتى تخطط له مسبقاً.",
        },
        {
          q: "هل أحتاج جراحة أم يكفي إجراء بدون جراحة؟",
          a: "غالباً تكون الإجابة الصادقة هي الحل غير الجراحي، وأحياناً تكون أنك لا تحتاج أياً منهما الآن. التقييم الجيد يخبرك بذلك — بما في ذلك حين يكون القرار هو الانتظار.",
        },
      ],
    },
  },
  {
    slug: "rhinoplasty",
    service: "nose",
    number: "02",
    en: {
      title: "Nose & profile",
      metaTitle: "Rhinoplasty in Cairo",
      metaDescription:
        "Rhinoplasty and septorhinoplasty with Dr. Ashraf Metwally, FRCS, EBOPRAS. Breathing, structure and profile assessed together across three Cairo clinics.",
      feeling: "I want balance from every angle — and to breathe well.",
      intro:
        "A nose is structural before it is cosmetic. Profile, internal airway, skin thickness and the proportions of the rest of the face behave as one connected system, and a plan that improves the shape while worsening the breathing has not succeeded. Both are assessed together.",
      exploreTitle: "What the consultation covers",
      explore: [
        "Breathing, airway and any history of obstruction or injury",
        "Profile relationships with the chin, lips and forehead",
        "Skin thickness, which governs how much definition is achievable",
        "How the result is expected to settle over the long term",
      ],
      recoveryTitle: "How recovery usually unfolds",
      recovery: [
        { label: "Phase 01", text: "Support, swelling and rest in the first weeks" },
        { label: "Phase 02", text: "Early return to routine as visible swelling eases" },
        { label: "Phase 03", text: "Gradual definition, continuing well beyond the first months" },
      ],
      optionsTitle: "Options often discussed",
      options: ["Rhinoplasty", "Septorhinoplasty", "Profile balancing", "Revision assessment"],
      faqTitle: "Common questions",
      faq: [
        {
          q: "How long until my nose looks final?",
          a: "Early swelling settles within weeks, but refinement continues for far longer — often a year or more, and longer again in thicker skin. Anyone promising a final result in a month is not describing rhinoplasty.",
        },
        {
          q: "Can breathing be corrected at the same time?",
          a: "Frequently yes, and where the septum or airway is involved it should be part of the same plan rather than a second operation.",
        },
        {
          q: "What if I have already had rhinoplasty elsewhere?",
          a: "Revision assessment is a different and more demanding conversation. It starts with understanding what was done before and what tissue is available to work with.",
        },
      ],
    },
    ar: {
      title: "الأنف وتناسق الوجه",
      metaTitle: "عمليات تجميل الأنف في القاهرة",
      metaDescription:
        "تجميل الأنف وتجميل الأنف مع الحاجز الأنفي مع د. أشرف متولي، زمالة الكلية الملكية والبورد الأوروبي. تقييم التنفس والتكوين والتناسق معاً.",
      feeling: "أريد تناسقاً من كل زاوية وتنفساً أفضل.",
      intro:
        "الأنف تكوين وظيفي قبل أن يكون شكلاً. التناسق ومجرى الهواء الداخلي وسُمك الجلد ونسب باقي الوجه تعمل كنظام واحد متصل، وأي خطة تحسّن الشكل وتضر بالتنفس لم تنجح. لذلك يُقيَّم الاثنان معاً.",
      exploreTitle: "ما تشمله الاستشارة",
      explore: [
        "التنفس ومجرى الهواء وأي تاريخ لانسداد أو إصابة",
        "علاقة الأنف بالذقن والشفاه والجبهة",
        "سُمك الجلد، وهو ما يحدد درجة التحديد الممكنة",
        "كيف يُتوقع أن تستقر النتيجة على المدى الطويل",
      ],
      recoveryTitle: "كيف يسير التعافي عادة",
      recovery: [
        { label: "المرحلة ٠١", text: "الدعامة والتورم والراحة في الأسابيع الأولى" },
        { label: "المرحلة ٠٢", text: "العودة المبكرة للروتين مع انحسار التورم الظاهر" },
        { label: "المرحلة ٠٣", text: "تحديد تدريجي يستمر لما بعد الأشهر الأولى" },
      ],
      optionsTitle: "خيارات تُناقش عادة",
      options: ["تجميل الأنف", "تجميل الأنف والحاجز", "موازنة الملامح الجانبية", "تقييم إعادة التجميل"],
      faqTitle: "أسئلة شائعة",
      faq: [
        {
          q: "متى تظهر النتيجة النهائية؟",
          a: "يهدأ التورم المبكر خلال أسابيع، لكن التحسن التفصيلي يستمر لفترة أطول بكثير — غالباً عاماً أو أكثر، وأطول في البشرة السميكة. من يعدك بنتيجة نهائية خلال شهر لا يصف عملية تجميل أنف حقيقية.",
        },
        {
          q: "هل يمكن تصحيح التنفس في نفس الوقت؟",
          a: "غالباً نعم، وحين يكون الحاجز الأنفي أو مجرى الهواء جزءاً من المشكلة يجب أن يكون ضمن نفس الخطة لا في عملية ثانية.",
        },
        {
          q: "ماذا لو أجريت العملية من قبل في مكان آخر؟",
          a: "تقييم إعادة التجميل حوار مختلف وأكثر تعقيداً. يبدأ بفهم ما تم سابقاً وما المتاح من الأنسجة للعمل عليه.",
        },
      ],
    },
  },
  {
    slug: "body-contouring",
    service: "body",
    number: "03",
    en: {
      title: "Body architecture",
      metaTitle: "Body Contouring & Tummy Tuck in Cairo",
      metaDescription:
        "Tummy tuck, liposculpture and post-weight-loss body contouring with Dr. Ashraf Metwally, Consultant Plastic Surgeon in Cairo.",
      feeling: "My shape no longer reflects how I feel.",
      intro:
        "Body contouring is a question of proportion, skin quality and muscle support — not of weight. Someone at a stable weight with loose skin after pregnancy or major weight loss has a different problem from someone carrying localised fat, and the two need different answers.",
      exploreTitle: "What the consultation covers",
      explore: [
        "Body proportions and which areas actually drive your concern",
        "Skin quality and whether it will retract on its own",
        "Muscle separation, common after pregnancy",
        "Mobility, recovery time and how it fits your life",
      ],
      recoveryTitle: "How recovery usually unfolds",
      recovery: [
        { label: "Phase 01", text: "Rest and protected movement, with support garments" },
        { label: "Phase 02", text: "Progressive mobility and a return to light activity" },
        { label: "Phase 03", text: "Return to full rhythm, including exercise" },
      ],
      optionsTitle: "Options often discussed",
      options: ["Tummy tuck", "Liposculpture", "Post-weight-loss contouring", "Muscle repair"],
      faqTitle: "Common questions",
      faq: [
        {
          q: "Is this a way to lose weight?",
          a: "No, and it is important to be clear about that. Contouring reshapes; it does not substitute for weight loss, and results are most predictable at a stable weight.",
        },
        {
          q: "What happens to the scar?",
          a: "Any procedure that removes skin leaves a scar. Where it sits, how it is planned around clothing, and how it matures are all part of the consultation rather than an afterthought.",
        },
        {
          q: "How soon can I lift my children or return to the gym?",
          a: "This is one of the most practical questions and deserves a specific answer for your procedure. It is planned before surgery, not improvised afterwards.",
        },
      ],
    },
    ar: {
      title: "هندسة القوام",
      metaTitle: "تنسيق القوام وشد البطن في القاهرة",
      metaDescription:
        "شد البطن ونحت القوام وتنسيق الجسم بعد فقدان الوزن مع د. أشرف متولي، استشاري جراحات التجميل بالقاهرة.",
      feeling: "قوامي لم يعد يعكس إحساسي بنفسي.",
      intro:
        "تنسيق القوام مسألة تناسق وجودة جلد ودعم عضلي — وليس مسألة وزن. من يثبت وزنه ولديه ترهل بعد الحمل أو بعد فقدان وزن كبير مشكلته مختلفة عمّن لديه تجمع دهني موضعي، ولكل منهما حل مختلف.",
      exploreTitle: "ما تشمله الاستشارة",
      explore: [
        "تناسق الجسم وتحديد المناطق التي تسبب انزعاجك فعلاً",
        "جودة الجلد وهل سينكمش من تلقاء نفسه",
        "انفصال عضلات البطن، وهو شائع بعد الحمل",
        "الحركة ومدة التعافي وكيف تتناسب مع حياتك",
      ],
      recoveryTitle: "كيف يسير التعافي عادة",
      recovery: [
        { label: "المرحلة ٠١", text: "راحة وحركة محسوبة مع المشدات الطبية" },
        { label: "المرحلة ٠٢", text: "زيادة تدريجية في الحركة والعودة لنشاط خفيف" },
        { label: "المرحلة ٠٣", text: "العودة الكاملة للنشاط بما فيه التمارين" },
      ],
      optionsTitle: "خيارات تُناقش عادة",
      options: ["شد البطن", "نحت القوام", "تنسيق ما بعد فقدان الوزن", "إصلاح العضلات"],
      faqTitle: "أسئلة شائعة",
      faq: [
        {
          q: "هل هذه وسيلة لإنقاص الوزن؟",
          a: "لا، ومن المهم أن يكون هذا واضحاً. تنسيق القوام يعيد تشكيل الجسم ولا يغني عن إنقاص الوزن، والنتائج تكون أكثر ثباتاً عند وزن مستقر.",
        },
        {
          q: "ماذا عن الندبة؟",
          a: "أي إجراء يزيل جلداً يترك ندبة. موضعها وتخطيطها بما يناسب الملابس وكيفية تحسنها مع الوقت كلها جزء من الاستشارة وليست تفصيلاً لاحقاً.",
        },
        {
          q: "متى أستطيع حمل أطفالي أو العودة للنادي؟",
          a: "هذا من أهم الأسئلة العملية ويستحق إجابة محددة حسب إجرائك. يُخطط له قبل الجراحة لا بعدها.",
        },
      ],
    },
  },
  {
    slug: "breast-surgery",
    service: "breast",
    number: "04",
    en: {
      title: "Breast proportion",
      metaTitle: "Breast Surgery in Cairo",
      metaDescription:
        "Breast lift, reduction and augmentation with Dr. Ashraf Metwally, Consultant Plastic Surgeon. A private, unhurried consultation across three Cairo clinics.",
      feeling: "I want proportion, comfort, and confidence.",
      intro:
        "This is a private conversation, and it is treated as one. Size is usually the least important part of it: position, symmetry, comfort, scar placement and how your plans for the future might change things all matter more to the outcome you will live with.",
      exploreTitle: "What the consultation covers",
      explore: [
        "Proportion and symmetry, measured rather than estimated",
        "Technique options and where scars would sit",
        "Physical comfort, including back and shoulder symptoms",
        "Future pregnancy, breastfeeding and long-term plans",
      ],
      recoveryTitle: "How recovery usually unfolds",
      recovery: [
        { label: "Phase 01", text: "Support and early comfort, with restricted lifting" },
        { label: "Phase 02", text: "Gradual return to normal activity" },
        { label: "Phase 03", text: "Settling into the final shape, with follow-up" },
      ],
      optionsTitle: "Options often discussed",
      options: ["Breast lift", "Reduction", "Augmentation", "Symmetry correction"],
      faqTitle: "Common questions",
      faq: [
        {
          q: "Will this affect breastfeeding later?",
          a: "It can, depending on the technique, and it is a factor that should shape the plan rather than be raised afterwards. Tell the surgeon if future pregnancy is possible.",
        },
        {
          q: "Is reduction a cosmetic procedure?",
          a: "Often it is as much about physical symptoms — back, neck and shoulder pain, or skin irritation — as about appearance, and it is assessed on both.",
        },
        {
          q: "Can I bring someone with me to the consultation?",
          a: "Yes. Many patients prefer to, and it frequently makes for a better conversation.",
        },
      ],
    },
    ar: {
      title: "تناسق الثدي",
      metaTitle: "جراحات الثدي في القاهرة",
      metaDescription:
        "رفع وتصغير وتكبير الثدي مع د. أشرف متولي، استشاري جراحات التجميل. استشارة بخصوصية ودون استعجال في ثلاث عيادات بالقاهرة.",
      feeling: "أبحث عن التناسق والراحة والثقة.",
      intro:
        "هذا حوار خاص، ويُتعامل معه على هذا الأساس. الحجم عادة أقل الأمور أهمية: الموضع والتماثل والراحة وموضع الندبات وكيف قد تغيّر خططك المستقبلية الأمور — كلها أهم للنتيجة التي ستعيش معها.",
      exploreTitle: "ما تشمله الاستشارة",
      explore: [
        "التناسق والتماثل بالقياس لا بالتقدير",
        "خيارات التقنية وأين ستكون الندبات",
        "الراحة الجسدية بما فيها أعراض الظهر والكتف",
        "الحمل والرضاعة والخطط المستقبلية",
      ],
      recoveryTitle: "كيف يسير التعافي عادة",
      recovery: [
        { label: "المرحلة ٠١", text: "الدعم والراحة المبكرة مع تقييد الحمل والرفع" },
        { label: "المرحلة ٠٢", text: "عودة تدريجية للنشاط الطبيعي" },
        { label: "المرحلة ٠٣", text: "استقرار الشكل النهائي مع المتابعة" },
      ],
      optionsTitle: "خيارات تُناقش عادة",
      options: ["رفع الثدي", "تصغير الثدي", "تكبير الثدي", "تصحيح التماثل"],
      faqTitle: "أسئلة شائعة",
      faq: [
        {
          q: "هل يؤثر ذلك على الرضاعة لاحقاً؟",
          a: "قد يؤثر حسب التقنية المستخدمة، وهو عامل يجب أن يشكّل الخطة لا أن يُطرح بعدها. أخبر الطبيب إن كان الحمل مستقبلاً وارداً.",
        },
        {
          q: "هل تصغير الثدي إجراء تجميلي فقط؟",
          a: "غالباً يتعلق بالأعراض الجسدية — آلام الظهر والرقبة والكتف أو تهيج الجلد — بقدر ما يتعلق بالمظهر، ويُقيَّم على الأساسين.",
        },
        {
          q: "هل يمكنني اصطحاب أحد معي للاستشارة؟",
          a: "بالطبع. كثير من المرضى يفضلون ذلك، وغالباً ما يجعل الحوار أفضل.",
        },
      ],
    },
  },
  {
    slug: "dental-care",
    service: "dental-check",
    number: "05",
    provider: {
      kind: "dental",
      en: "Care Point dental team",
      ar: "فريق كير بوينت لطب الأسنان",
    },
    en: {
      title: "Dental care & smile design",
      metaTitle: "Dental Care & Smile Design in Cairo",
      metaDescription:
        "Dental consultations, professional cleaning, whitening, veneers and implant assessment with the Care Point dental team across three Cairo clinics.",
      feeling: "I want a healthy smile that still feels like mine.",
      intro:
        "A durable smile starts with health, function and proportion — not a shade chart. The dental team assesses the teeth, gums, bite and supporting bone together before discussing cleaning, whitening, veneers or implants. The right first appointment is an assessment; any treatment plan follows the findings.",
      exploreTitle: "What the dental consultation covers",
      explore: [
        "Teeth, gums and bite health",
        "Your goals for colour, shape and proportion",
        "X-rays or further imaging when clinically indicated",
        "A staged plan, including alternatives and maintenance",
      ],
      recoveryTitle: "How care is usually planned",
      recovery: [
        {
          label: "Assessment",
          text: "A clinical examination and a clear record of the concern before any procedure is proposed",
        },
        {
          label: "Foundation",
          text: "Cleaning or gum care first when the supporting tissues need attention",
        },
        {
          label: "Treatment & review",
          text: "Procedure-specific care and follow-up based on healing, function and the agreed plan",
        },
      ],
      optionsTitle: "Services available to book",
      options: [
        "Dental consultation & cleaning",
        "Veneers & whitening",
        "Dental implants",
      ],
      faqTitle: "Common dental questions",
      faq: [
        {
          q: "Which appointment should I choose first?",
          a: "Choose Dental consultation & cleaning if you are unsure. It gives the dental team a chance to examine your teeth, gums and bite before recommending a cosmetic or implant pathway.",
        },
        {
          q: "Will veneers look natural?",
          a: "That depends on proportion, surface texture, colour and how much healthy tooth structure can be preserved. A consultation should explain whether whitening, alignment, bonding or no treatment is a better fit before veneers are considered.",
        },
        {
          q: "Can an implant be completed in one visit?",
          a: "Implant care is usually staged. Bone and gum health, imaging, healing time and the final restoration all affect the sequence, so an examination is needed before a timeline can be discussed.",
        },
      ],
    },
    ar: {
      title: "العناية بالأسنان وتصميم الابتسامة",
      metaTitle: "العناية بالأسنان وتصميم الابتسامة في القاهرة",
      metaDescription:
        "استشارات الأسنان والتنظيف الاحترافي والتبييض والفينير وتقييم زراعة الأسنان مع فريق كير بوينت لطب الأسنان في ثلاثة فروع بالقاهرة.",
      feeling: "أريد ابتسامة صحية تشبهني وتناسب ملامحي.",
      intro:
        "تبدأ الابتسامة التي تدوم بصحة الفم والوظيفة والتناسق، لا بدرجة اللون فقط. يقيّم فريق الأسنان الأسنان واللثة والإطباق والعظم الداعم معاً قبل مناقشة التنظيف أو التبييض أو الفينير أو الزراعة. الخطوة الأولى الصحيحة هي التقييم، وتأتي خطة العلاج بعد نتائج الفحص.",
      exploreTitle: "ما تشمله استشارة الأسنان",
      explore: [
        "صحة الأسنان واللثة والإطباق",
        "أهدافك للون والشكل والتناسق",
        "الأشعة أو التصوير الإضافي عند الحاجة الطبية",
        "خطة مرحلية تشمل البدائل والعناية طويلة المدى",
      ],
      recoveryTitle: "كيف تُخطط الرعاية عادة",
      recovery: [
        {
          label: "التقييم",
          text: "فحص سريري وتوثيق واضح للمشكلة قبل اقتراح أي إجراء",
        },
        {
          label: "الأساس الصحي",
          text: "البدء بالتنظيف أو علاج اللثة عندما تحتاج الأنسجة الداعمة إلى عناية",
        },
        {
          label: "العلاج والمراجعة",
          text: "رعاية ومتابعة تناسب الإجراء حسب الالتئام والوظيفة والخطة المتفق عليها",
        },
      ],
      optionsTitle: "خدمات متاحة للحجز",
      options: [
        "استشارة وتنظيف الأسنان",
        "الفينير وتبييض الأسنان",
        "زراعة الأسنان",
      ],
      faqTitle: "أسئلة شائعة عن الأسنان",
      faq: [
        {
          q: "أي موعد أختار أولاً؟",
          a: "اختر استشارة وتنظيف الأسنان إذا لم تكن متأكداً. يتيح ذلك لفريق الأسنان فحص الأسنان واللثة والإطباق قبل اقتراح مسار تجميلي أو زراعة.",
        },
        {
          q: "هل سيبدو الفينير طبيعياً؟",
          a: "يعتمد ذلك على التناسق وملمس السطح واللون ومقدار بنية السن السليمة التي يمكن الحفاظ عليها. يجب أن توضّح الاستشارة ما إذا كان التبييض أو التقويم أو الترميم التجميلي أو عدم التدخل أنسب قبل التفكير في الفينير.",
        },
        {
          q: "هل يمكن إكمال زراعة السن في زيارة واحدة؟",
          a: "تتم رعاية الزراعة على مراحل عادة. تؤثر صحة العظم واللثة والتصوير ووقت الالتئام والتركيبة النهائية في التسلسل، لذلك يلزم الفحص قبل مناقشة المدة المتوقعة.",
        },
      ],
    },
  },
];

export function findTreatment(slug: string): Treatment | undefined {
  return TREATMENTS.find((treatment) => treatment.slug === slug);
}

export function treatmentCopy(treatment: Treatment, language: Language): TreatmentCopy {
  return language === "ar" ? treatment.ar : treatment.en;
}

/** `/treatments/rhinoplasty` and `/ar/treatments/rhinoplasty`. */
export function treatmentPath(slug: string, language: Language): string {
  return language === "ar" ? `/ar/treatments/${slug}` : `/treatments/${slug}`;
}
