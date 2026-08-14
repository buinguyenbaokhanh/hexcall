import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  X, Info, Sparkles, ChevronRight, AlertTriangle, Database,
  RefreshCw, WifiOff, Check, Layers, Zap, Users, History, Swords, Hexagon,
  TrendingUp,
} from "lucide-react";
import Review from "./Review.jsx";
import CompBuild from "./CompBuild.jsx";
import Advisor from "./Advisor.jsx";
import Planner from "./Planner.jsx";
import AugmentsTab from "./Augments.jsx";
import ChampionsTab from "./Champions.jsx";
import CompsTab from "./Comps.jsx";
import ItemsTab from "./Items.jsx";
import TraitsTab from "./Traits.jsx";
import TrendsTab from "./Trends.jsx";
import { ChampionIcon, AugmentIcon, carryIdFromSig } from "./icons.jsx";
import { timeAgo } from "./table.jsx";
import {
  buildIndex, evaluate, PlacementTrack, AxisLegend,
} from "./scoring.jsx";

// Two deployment shapes:
//   * dev / self-hosted -- Flask serves /api, Vite proxies it, review works.
//   * static hosting (GitHub Pages, Netlify) -- no server at all; the build
//     ships the published JSON alongside the app and reads it directly.
// STATIC_MODE must therefore be a build-time switch rather than a constant:
// hardcoding `false` produced a Pages deploy that fetched /api and got the
// SPA's own index.html back for every request.
const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === "true";
// BASE_URL already carries the deploy prefix ("/" or "/<repo>/"), so deriving
// from it keeps the data path correct on project Pages without a second env
// var — and unlike a relative "./data" it doesn't break if the site is ever
// reached without the trailing slash.
const API_BASE = import.meta.env.VITE_API_BASE
  || (STATIC_MODE ? `${import.meta.env.BASE_URL}data` : "/api");
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const urlFor = (what) =>
  STATIC_MODE
    ? `${API_BASE}/${what === "manifest" ? "manifest" : what}.json`
    : `${API_BASE}/${what === "manifest" ? "manifest" : `stats/${what}`}`;

const FALLBACK_STATS = {"sample_size":11938,"baseline_placement":4.503,"patch":"17.8","comps":{"Anima5_Duelist2 :: TFT17_Fiora":{"n":2003,"avg_placement":3.815,"top4_rate":0.6316,"win_rate":0.1787,"stderr":0.049,"play_rate":0.1678},"Brawler6_Duelist2 :: TFT17_MasterYi":{"n":1309,"avg_placement":5.011,"top4_rate":0.4041,"win_rate":0.0726,"stderr":0.06,"play_rate":0.1096},"Bruiser4_Gunner2 :: TFT17_Samira":{"n":1478,"avg_placement":4.654,"top4_rate":0.4581,"win_rate":0.1015,"stderr":0.057,"play_rate":0.1238},"Stargazer3_Sorcerer2 :: TFT17_Vex":{"n":1222,"avg_placement":4.343,"top4_rate":0.5368,"win_rate":0.1318,"stderr":0.065,"play_rate":0.1024},"Shepherd4_Sorcerer2 :: TFT17_LeBlanc":{"n":954,"avg_placement":5.233,"top4_rate":0.3742,"win_rate":0.0545,"stderr":0.07,"play_rate":0.0799},"NOVA4_Duelist2 :: TFT17_Akali":{"n":1681,"avg_placement":4.077,"top4_rate":0.5758,"win_rate":0.1511,"stderr":0.054,"play_rate":0.1408},"Stargazer4_Vanguard2 :: TFT17_Xayah":{"n":1895,"avg_placement":4.104,"top4_rate":0.5784,"win_rate":0.1567,"stderr":0.052,"play_rate":0.1587},"Sorcerer6_Shepherd2 :: TFT17_Lulu":{"n":635,"avg_placement":5.575,"top4_rate":0.3087,"win_rate":0.0504,"stderr":0.084,"play_rate":0.0532},"DarkStar4_Sniper2 :: TFT17_Jhin":{"n":761,"avg_placement":5.534,"top4_rate":0.3022,"win_rate":0.0539,"stderr":0.078,"play_rate":0.0637}},"augments":{"TFT17_Augment_Featherweights":{"n":2576,"avg_placement":4.759,"top4_rate":0.4561,"win_rate":0.092,"stderr":0.044,"play_rate":0.2158},"TFT17_Augment_ComponentGrabBag":{"n":2607,"avg_placement":4.615,"top4_rate":0.4833,"win_rate":0.1116,"stderr":0.045,"play_rate":0.2184},"TFT17_Augment_SalvageBin":{"n":2678,"avg_placement":5.005,"top4_rate":0.4149,"win_rate":0.0751,"stderr":0.043,"play_rate":0.2243},"TFT17_Augment_DiamondHands":{"n":2614,"avg_placement":4.691,"top4_rate":0.4637,"win_rate":0.1056,"stderr":0.044,"play_rate":0.219},"TFT17_Augment_TradeSector":{"n":2678,"avg_placement":4.43,"top4_rate":0.5176,"win_rate":0.1299,"stderr":0.044,"play_rate":0.2243},"TFT17_Augment_PandorasItems":{"n":2611,"avg_placement":4.045,"top4_rate":0.5814,"win_rate":0.1658,"stderr":0.044,"play_rate":0.2187},"TFT17_Augment_HedgeFund":{"n":2736,"avg_placement":4.555,"top4_rate":0.4923,"win_rate":0.1239,"stderr":0.044,"play_rate":0.2292},"TFT17_Augment_StandUnited":{"n":2605,"avg_placement":4.404,"top4_rate":0.5228,"win_rate":0.1332,"stderr":0.045,"play_rate":0.2182},"TFT17_Augment_RichGetRicher":{"n":2669,"avg_placement":4.02,"top4_rate":0.5864,"win_rate":0.1645,"stderr":0.044,"play_rate":0.2236},"TFT17_Augment_BuiltDifferent":{"n":2618,"avg_placement":4.472,"top4_rate":0.5115,"win_rate":0.1199,"stderr":0.044,"play_rate":0.2193},"TFT17_Augment_Preparation":{"n":2616,"avg_placement":4.439,"top4_rate":0.5092,"win_rate":0.1189,"stderr":0.044,"play_rate":0.2191},"TFT17_Augment_FastForward":{"n":2591,"avg_placement":4.536,"top4_rate":0.4871,"win_rate":0.1181,"stderr":0.044,"play_rate":0.217}},"augment_comp_pairs":[{"augment":"TFT17_Augment_RichGetRicher","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":248,"avg_placement":2.956,"top4_rate":0.8065,"win_rate":0.2823,"stderr":0.122,"lift_vs_comp":-1.387,"lift_vs_field":-1.548},{"augment":"TFT17_Augment_PandorasItems","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":416,"avg_placement":3.084,"top4_rate":0.762,"win_rate":0.3029,"stderr":0.098,"lift_vs_comp":-1.02,"lift_vs_field":-1.419},{"augment":"TFT17_Augment_PandorasItems","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":321,"avg_placement":3.85,"top4_rate":0.6137,"win_rate":0.1682,"stderr":0.113,"lift_vs_comp":-0.804,"lift_vs_field":-0.653},{"augment":"TFT17_Augment_RichGetRicher","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":331,"avg_placement":3.934,"top4_rate":0.5921,"win_rate":0.1571,"stderr":0.115,"lift_vs_comp":-0.72,"lift_vs_field":-0.57},{"augment":"TFT17_Augment_StandUnited","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":432,"avg_placement":3.157,"top4_rate":0.7708,"win_rate":0.2616,"stderr":0.097,"lift_vs_comp":-0.658,"lift_vs_field":-1.346},{"augment":"TFT17_Augment_DiamondHands","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":288,"avg_placement":4.392,"top4_rate":0.5243,"win_rate":0.125,"stderr":0.127,"lift_vs_comp":-0.619,"lift_vs_field":-0.111},{"augment":"TFT17_Augment_FastForward","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":270,"avg_placement":3.741,"top4_rate":0.637,"win_rate":0.2,"stderr":0.134,"lift_vs_comp":-0.602,"lift_vs_field":-0.763},{"augment":"TFT17_Augment_RichGetRicher","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":182,"avg_placement":4.687,"top4_rate":0.4945,"win_rate":0.0989,"stderr":0.172,"lift_vs_comp":-0.546,"lift_vs_field":0.184},{"augment":"TFT17_Augment_BuiltDifferent","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":165,"avg_placement":4.994,"top4_rate":0.3879,"win_rate":0.0727,"stderr":0.166,"lift_vs_comp":-0.54,"lift_vs_field":0.491},{"augment":"TFT17_Augment_Preparation","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":298,"avg_placement":4.144,"top4_rate":0.5638,"win_rate":0.1342,"stderr":0.127,"lift_vs_comp":-0.51,"lift_vs_field":-0.359},{"augment":"TFT17_Augment_TradeSector","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":364,"avg_placement":3.591,"top4_rate":0.6648,"win_rate":0.217,"stderr":0.111,"lift_vs_comp":-0.486,"lift_vs_field":-0.913},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":378,"avg_placement":3.619,"top4_rate":0.664,"win_rate":0.1878,"stderr":0.109,"lift_vs_comp":-0.458,"lift_vs_field":-0.884},{"augment":"TFT17_Augment_RichGetRicher","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":442,"avg_placement":3.661,"top4_rate":0.6471,"win_rate":0.2149,"stderr":0.106,"lift_vs_comp":-0.443,"lift_vs_field":-0.843},{"augment":"TFT17_Augment_RichGetRicher","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":191,"avg_placement":5.099,"top4_rate":0.3874,"win_rate":0.0785,"stderr":0.163,"lift_vs_comp":-0.435,"lift_vs_field":0.596},{"augment":"TFT17_Augment_RichGetRicher","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":465,"avg_placement":3.426,"top4_rate":0.6903,"win_rate":0.2172,"stderr":0.099,"lift_vs_comp":-0.389,"lift_vs_field":-1.077},{"augment":"TFT17_Augment_Featherweights","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":281,"avg_placement":4.623,"top4_rate":0.4804,"win_rate":0.0961,"stderr":0.129,"lift_vs_comp":-0.388,"lift_vs_field":0.12},{"augment":"TFT17_Augment_HedgeFund","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":328,"avg_placement":3.966,"top4_rate":0.6037,"win_rate":0.1829,"stderr":0.127,"lift_vs_comp":-0.377,"lift_vs_field":-0.537},{"augment":"TFT17_Augment_RichGetRicher","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":373,"avg_placement":3.716,"top4_rate":0.6354,"win_rate":0.1823,"stderr":0.114,"lift_vs_comp":-0.361,"lift_vs_field":-0.787},{"augment":"TFT17_Augment_PandorasItems","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":181,"avg_placement":5.188,"top4_rate":0.3536,"win_rate":0.0497,"stderr":0.155,"lift_vs_comp":-0.346,"lift_vs_field":0.685},{"augment":"TFT17_Augment_PandorasItems","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":429,"avg_placement":3.469,"top4_rate":0.704,"win_rate":0.1841,"stderr":0.096,"lift_vs_comp":-0.346,"lift_vs_field":-1.035},{"augment":"TFT17_Augment_DiamondHands","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":142,"avg_placement":5.246,"top4_rate":0.3803,"win_rate":0.0775,"stderr":0.189,"lift_vs_comp":-0.329,"lift_vs_field":0.743},{"augment":"TFT17_Augment_PandorasItems","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":289,"avg_placement":4.689,"top4_rate":0.4394,"win_rate":0.0969,"stderr":0.128,"lift_vs_comp":-0.322,"lift_vs_field":0.185},{"augment":"TFT17_Augment_PandorasItems","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":148,"avg_placement":5.27,"top4_rate":0.3446,"win_rate":0.0946,"stderr":0.184,"lift_vs_comp":-0.305,"lift_vs_field":0.767},{"augment":"TFT17_Augment_PandorasItems","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":358,"avg_placement":3.793,"top4_rate":0.6229,"win_rate":0.1955,"stderr":0.118,"lift_vs_comp":-0.284,"lift_vs_field":-0.71},{"augment":"TFT17_Augment_RichGetRicher","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":155,"avg_placement":5.303,"top4_rate":0.3548,"win_rate":0.0387,"stderr":0.17,"lift_vs_comp":-0.272,"lift_vs_field":0.8},{"augment":"TFT17_Augment_PandorasItems","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":207,"avg_placement":4.961,"top4_rate":0.4203,"win_rate":0.0821,"stderr":0.156,"lift_vs_comp":-0.272,"lift_vs_field":0.458},{"augment":"TFT17_Augment_StandUnited","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":421,"avg_placement":3.834,"top4_rate":0.6318,"win_rate":0.1758,"stderr":0.105,"lift_vs_comp":-0.27,"lift_vs_field":-0.67},{"augment":"TFT17_Augment_FastForward","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":196,"avg_placement":5.046,"top4_rate":0.4184,"win_rate":0.0408,"stderr":0.149,"lift_vs_comp":-0.187,"lift_vs_field":0.543},{"augment":"TFT17_Augment_Featherweights","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":133,"avg_placement":5.391,"top4_rate":0.3534,"win_rate":0.0526,"stderr":0.182,"lift_vs_comp":-0.184,"lift_vs_field":0.888},{"augment":"TFT17_Augment_TradeSector","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":217,"avg_placement":5.065,"top4_rate":0.3963,"win_rate":0.0599,"stderr":0.151,"lift_vs_comp":-0.168,"lift_vs_field":0.561},{"augment":"TFT17_Augment_PandorasItems","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":262,"avg_placement":4.179,"top4_rate":0.5725,"win_rate":0.1374,"stderr":0.134,"lift_vs_comp":-0.164,"lift_vs_field":-0.324},{"augment":"TFT17_Augment_TradeSector","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":353,"avg_placement":4.51,"top4_rate":0.5014,"win_rate":0.1275,"stderr":0.119,"lift_vs_comp":-0.144,"lift_vs_field":0.007},{"augment":"TFT17_Augment_Preparation","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":309,"avg_placement":4.88,"top4_rate":0.4175,"win_rate":0.1003,"stderr":0.128,"lift_vs_comp":-0.131,"lift_vs_field":0.377},{"augment":"TFT17_Augment_Preparation","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":218,"avg_placement":5.11,"top4_rate":0.4083,"win_rate":0.0688,"stderr":0.15,"lift_vs_comp":-0.123,"lift_vs_field":0.607},{"augment":"TFT17_Augment_Preparation","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":369,"avg_placement":3.957,"top4_rate":0.5935,"win_rate":0.1355,"stderr":0.112,"lift_vs_comp":-0.12,"lift_vs_field":-0.547},{"augment":"TFT17_Augment_StandUnited","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":254,"avg_placement":4.228,"top4_rate":0.5709,"win_rate":0.1417,"stderr":0.143,"lift_vs_comp":-0.115,"lift_vs_field":-0.275},{"augment":"TFT17_Augment_StandUnited","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":130,"avg_placement":5.485,"top4_rate":0.3077,"win_rate":0.0538,"stderr":0.194,"lift_vs_comp":-0.09,"lift_vs_field":0.981},{"augment":"TFT17_Augment_StandUnited","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":167,"avg_placement":5.461,"top4_rate":0.2814,"win_rate":0.0659,"stderr":0.167,"lift_vs_comp":-0.073,"lift_vs_field":0.958},{"augment":"TFT17_Augment_Preparation","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":411,"avg_placement":4.041,"top4_rate":0.5742,"win_rate":0.1582,"stderr":0.111,"lift_vs_comp":-0.063,"lift_vs_field":-0.462},{"augment":"TFT17_Augment_TradeSector","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":455,"avg_placement":3.752,"top4_rate":0.6549,"win_rate":0.189,"stderr":0.105,"lift_vs_comp":-0.063,"lift_vs_field":-0.752},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":320,"avg_placement":4.612,"top4_rate":0.45,"win_rate":0.1062,"stderr":0.119,"lift_vs_comp":-0.042,"lift_vs_field":0.109},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":267,"avg_placement":4.974,"top4_rate":0.4419,"win_rate":0.0674,"stderr":0.132,"lift_vs_comp":-0.037,"lift_vs_field":0.471},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":450,"avg_placement":4.069,"top4_rate":0.5911,"win_rate":0.1578,"stderr":0.104,"lift_vs_comp":-0.035,"lift_vs_field":-0.434},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":183,"avg_placement":5.508,"top4_rate":0.3169,"win_rate":0.0492,"stderr":0.157,"lift_vs_comp":-0.026,"lift_vs_field":1.005},{"augment":"TFT17_Augment_BuiltDifferent","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":388,"avg_placement":4.052,"top4_rate":0.6057,"win_rate":0.1521,"stderr":0.113,"lift_vs_comp":-0.025,"lift_vs_field":-0.452},{"augment":"TFT17_Augment_TradeSector","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":150,"avg_placement":5.573,"top4_rate":0.3067,"win_rate":0.06,"stderr":0.174,"lift_vs_comp":-0.002,"lift_vs_field":1.07},{"augment":"TFT17_Augment_Preparation","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":140,"avg_placement":5.579,"top4_rate":0.3214,"win_rate":0.0286,"stderr":0.17,"lift_vs_comp":0.004,"lift_vs_field":1.075},{"augment":"TFT17_Augment_StandUnited","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":291,"avg_placement":5.024,"top4_rate":0.4055,"win_rate":0.0722,"stderr":0.128,"lift_vs_comp":0.013,"lift_vs_field":0.521},{"augment":"TFT17_Augment_HedgeFund","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":238,"avg_placement":5.248,"top4_rate":0.3782,"win_rate":0.0462,"stderr":0.138,"lift_vs_comp":0.015,"lift_vs_field":0.745},{"augment":"TFT17_Augment_Preparation","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":152,"avg_placement":5.553,"top4_rate":0.2632,"win_rate":0.0658,"stderr":0.171,"lift_vs_comp":0.019,"lift_vs_field":1.049},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":201,"avg_placement":5.264,"top4_rate":0.3632,"win_rate":0.0547,"stderr":0.148,"lift_vs_comp":0.031,"lift_vs_field":0.76},{"augment":"TFT17_Augment_TradeSector","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":422,"avg_placement":4.135,"top4_rate":0.5735,"win_rate":0.154,"stderr":0.111,"lift_vs_comp":0.031,"lift_vs_field":-0.368},{"augment":"TFT17_Augment_FastForward","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":284,"avg_placement":5.049,"top4_rate":0.4049,"win_rate":0.0634,"stderr":0.128,"lift_vs_comp":0.038,"lift_vs_field":0.546},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":422,"avg_placement":3.86,"top4_rate":0.6351,"win_rate":0.1825,"stderr":0.108,"lift_vs_comp":0.045,"lift_vs_field":-0.643},{"augment":"TFT17_Augment_TradeSector","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":164,"avg_placement":5.585,"top4_rate":0.3049,"win_rate":0.0366,"stderr":0.162,"lift_vs_comp":0.051,"lift_vs_field":1.082},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":443,"avg_placement":3.871,"top4_rate":0.614,"win_rate":0.1919,"stderr":0.108,"lift_vs_comp":0.056,"lift_vs_field":-0.632},{"augment":"TFT17_Augment_FastForward","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":159,"avg_placement":5.597,"top4_rate":0.2704,"win_rate":0.0566,"stderr":0.161,"lift_vs_comp":0.063,"lift_vs_field":1.094},{"augment":"TFT17_Augment_HedgeFund","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":455,"avg_placement":3.892,"top4_rate":0.6242,"win_rate":0.178,"stderr":0.107,"lift_vs_comp":0.077,"lift_vs_field":-0.611},{"augment":"TFT17_Augment_FastForward","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":325,"avg_placement":4.745,"top4_rate":0.44,"win_rate":0.0862,"stderr":0.121,"lift_vs_comp":0.091,"lift_vs_field":0.241},{"augment":"TFT17_Augment_TradeSector","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":282,"avg_placement":5.11,"top4_rate":0.3794,"win_rate":0.0532,"stderr":0.124,"lift_vs_comp":0.099,"lift_vs_field":0.607},{"augment":"TFT17_Augment_HedgeFund","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":139,"avg_placement":5.676,"top4_rate":0.295,"win_rate":0.0504,"stderr":0.183,"lift_vs_comp":0.101,"lift_vs_field":1.173},{"augment":"TFT17_Augment_HedgeFund","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":429,"avg_placement":4.205,"top4_rate":0.5594,"win_rate":0.1469,"stderr":0.111,"lift_vs_comp":0.101,"lift_vs_field":-0.298},{"augment":"TFT17_Augment_FastForward","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":429,"avg_placement":3.921,"top4_rate":0.5944,"win_rate":0.1725,"stderr":0.106,"lift_vs_comp":0.106,"lift_vs_field":-0.583},{"augment":"TFT17_Augment_RichGetRicher","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":282,"avg_placement":5.135,"top4_rate":0.3759,"win_rate":0.0496,"stderr":0.122,"lift_vs_comp":0.124,"lift_vs_field":0.631},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":368,"avg_placement":4.236,"top4_rate":0.5842,"win_rate":0.1087,"stderr":0.11,"lift_vs_comp":0.132,"lift_vs_field":-0.267},{"augment":"TFT17_Augment_HedgeFund","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":393,"avg_placement":4.214,"top4_rate":0.5394,"win_rate":0.1603,"stderr":0.116,"lift_vs_comp":0.137,"lift_vs_field":-0.29},{"augment":"TFT17_Augment_DiamondHands","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":203,"avg_placement":5.384,"top4_rate":0.3399,"win_rate":0.0542,"stderr":0.15,"lift_vs_comp":0.151,"lift_vs_field":0.881},{"augment":"TFT17_Augment_TradeSector","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":271,"avg_placement":4.506,"top4_rate":0.5092,"win_rate":0.1107,"stderr":0.136,"lift_vs_comp":0.163,"lift_vs_field":0.002},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":282,"avg_placement":4.507,"top4_rate":0.4894,"win_rate":0.0887,"stderr":0.134,"lift_vs_comp":0.164,"lift_vs_field":0.004},{"augment":"TFT17_Augment_Preparation","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":262,"avg_placement":4.515,"top4_rate":0.5038,"win_rate":0.1031,"stderr":0.141,"lift_vs_comp":0.172,"lift_vs_field":0.012},{"augment":"TFT17_Augment_StandUnited","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":337,"avg_placement":4.828,"top4_rate":0.4273,"win_rate":0.0801,"stderr":0.116,"lift_vs_comp":0.174,"lift_vs_field":0.325},{"augment":"TFT17_Augment_FastForward","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":416,"avg_placement":4.286,"top4_rate":0.5337,"win_rate":0.1514,"stderr":0.113,"lift_vs_comp":0.182,"lift_vs_field":-0.217},{"augment":"TFT17_Augment_Preparation","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":457,"avg_placement":3.998,"top4_rate":0.5996,"win_rate":0.151,"stderr":0.103,"lift_vs_comp":0.183,"lift_vs_field":-0.505},{"augment":"TFT17_Augment_HedgeFund","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":323,"avg_placement":4.848,"top4_rate":0.4241,"win_rate":0.096,"stderr":0.119,"lift_vs_comp":0.194,"lift_vs_field":0.345},{"augment":"TFT17_Augment_HedgeFund","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":275,"avg_placement":5.207,"top4_rate":0.3636,"win_rate":0.0473,"stderr":0.128,"lift_vs_comp":0.196,"lift_vs_field":0.704},{"augment":"TFT17_Augment_HedgeFund","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":156,"avg_placement":5.731,"top4_rate":0.2885,"win_rate":0.0641,"stderr":0.175,"lift_vs_comp":0.197,"lift_vs_field":1.228},{"augment":"TFT17_Augment_Featherweights","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":287,"avg_placement":4.544,"top4_rate":0.5087,"win_rate":0.115,"stderr":0.133,"lift_vs_comp":0.201,"lift_vs_field":0.04},{"augment":"TFT17_Augment_StandUnited","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":218,"avg_placement":5.436,"top4_rate":0.3578,"win_rate":0.0321,"stderr":0.139,"lift_vs_comp":0.203,"lift_vs_field":0.933},{"augment":"TFT17_Augment_FastForward","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":360,"avg_placement":4.283,"top4_rate":0.5361,"win_rate":0.125,"stderr":0.115,"lift_vs_comp":0.206,"lift_vs_field":-0.22},{"augment":"TFT17_Augment_StandUnited","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":355,"avg_placement":4.285,"top4_rate":0.538,"win_rate":0.1437,"stderr":0.124,"lift_vs_comp":0.208,"lift_vs_field":-0.219},{"augment":"TFT17_Augment_FastForward","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":152,"avg_placement":5.789,"top4_rate":0.2434,"win_rate":0.0461,"stderr":0.156,"lift_vs_comp":0.214,"lift_vs_field":1.286},{"augment":"TFT17_Augment_Featherweights","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":204,"avg_placement":5.451,"top4_rate":0.348,"win_rate":0.0245,"stderr":0.144,"lift_vs_comp":0.218,"lift_vs_field":0.948},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":211,"avg_placement":5.469,"top4_rate":0.2986,"win_rate":0.0521,"stderr":0.144,"lift_vs_comp":0.236,"lift_vs_field":0.966},{"augment":"TFT17_Augment_DiamondHands","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":450,"avg_placement":4.073,"top4_rate":0.5778,"win_rate":0.1667,"stderr":0.108,"lift_vs_comp":0.258,"lift_vs_field":-0.43},{"augment":"TFT17_Augment_BuiltDifferent","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":123,"avg_placement":5.837,"top4_rate":0.2683,"win_rate":0.0569,"stderr":0.192,"lift_vs_comp":0.262,"lift_vs_field":1.334},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":333,"avg_placement":4.925,"top4_rate":0.4144,"win_rate":0.0871,"stderr":0.12,"lift_vs_comp":0.271,"lift_vs_field":0.422},{"augment":"TFT17_Augment_DiamondHands","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":172,"avg_placement":5.808,"top4_rate":0.2558,"win_rate":0.0523,"stderr":0.164,"lift_vs_comp":0.274,"lift_vs_field":1.305},{"augment":"TFT17_Augment_DiamondHands","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":380,"avg_placement":4.374,"top4_rate":0.5237,"win_rate":0.1026,"stderr":0.111,"lift_vs_comp":0.297,"lift_vs_field":-0.13},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":292,"avg_placement":5.329,"top4_rate":0.3493,"win_rate":0.0479,"stderr":0.124,"lift_vs_comp":0.318,"lift_vs_field":0.826},{"augment":"TFT17_Augment_Featherweights","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":444,"avg_placement":4.14,"top4_rate":0.5653,"win_rate":0.1351,"stderr":0.104,"lift_vs_comp":0.325,"lift_vs_field":-0.364},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":131,"avg_placement":5.901,"top4_rate":0.2443,"win_rate":0.0382,"stderr":0.184,"lift_vs_comp":0.326,"lift_vs_field":1.397},{"augment":"TFT17_Augment_SalvageBin","comp":"Shepherd4_Sorcerer2 :: TFT17_LeBlanc","n":228,"avg_placement":5.57,"top4_rate":0.3114,"win_rate":0.0395,"stderr":0.135,"lift_vs_comp":0.337,"lift_vs_field":1.067},{"augment":"TFT17_Augment_ComponentGrabBag","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":268,"avg_placement":4.698,"top4_rate":0.4813,"win_rate":0.1007,"stderr":0.138,"lift_vs_comp":0.355,"lift_vs_field":0.194},{"augment":"TFT17_Augment_SalvageBin","comp":"Sorcerer6_Shepherd2 :: TFT17_Lulu","n":134,"avg_placement":5.933,"top4_rate":0.2537,"win_rate":0.0149,"stderr":0.167,"lift_vs_comp":0.358,"lift_vs_field":1.43},{"augment":"TFT17_Augment_DiamondHands","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":297,"avg_placement":5.017,"top4_rate":0.367,"win_rate":0.0875,"stderr":0.127,"lift_vs_comp":0.363,"lift_vs_field":0.514},{"augment":"TFT17_Augment_SalvageBin","comp":"Anima5_Duelist2 :: TFT17_Fiora","n":423,"avg_placement":4.189,"top4_rate":0.5745,"win_rate":0.13,"stderr":0.108,"lift_vs_comp":0.374,"lift_vs_field":-0.314},{"augment":"TFT17_Augment_SalvageBin","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":168,"avg_placement":5.946,"top4_rate":0.2619,"win_rate":0.0417,"stderr":0.167,"lift_vs_comp":0.412,"lift_vs_field":1.443},{"augment":"TFT17_Augment_Featherweights","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":398,"avg_placement":4.518,"top4_rate":0.4925,"win_rate":0.1281,"stderr":0.113,"lift_vs_comp":0.414,"lift_vs_field":0.014},{"augment":"TFT17_Augment_Featherweights","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":346,"avg_placement":4.517,"top4_rate":0.5087,"win_rate":0.0925,"stderr":0.12,"lift_vs_comp":0.44,"lift_vs_field":0.014},{"augment":"TFT17_Augment_SalvageBin","comp":"Brawler6_Duelist2 :: TFT17_MasterYi","n":308,"avg_placement":5.458,"top4_rate":0.3247,"win_rate":0.0584,"stderr":0.118,"lift_vs_comp":0.447,"lift_vs_field":0.955},{"augment":"TFT17_Augment_DiamondHands","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":255,"avg_placement":4.792,"top4_rate":0.451,"win_rate":0.098,"stderr":0.141,"lift_vs_comp":0.449,"lift_vs_field":0.289},{"augment":"TFT17_Augment_SalvageBin","comp":"NOVA4_Duelist2 :: TFT17_Akali","n":376,"avg_placement":4.532,"top4_rate":0.4867,"win_rate":0.1197,"stderr":0.118,"lift_vs_comp":0.455,"lift_vs_field":0.029},{"augment":"TFT17_Augment_Featherweights","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":336,"avg_placement":5.119,"top4_rate":0.369,"win_rate":0.0595,"stderr":0.118,"lift_vs_comp":0.465,"lift_vs_field":0.616},{"augment":"TFT17_Augment_DiamondHands","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":427,"avg_placement":4.574,"top4_rate":0.4941,"win_rate":0.103,"stderr":0.106,"lift_vs_comp":0.47,"lift_vs_field":0.071},{"augment":"TFT17_Augment_SalvageBin","comp":"Bruiser4_Gunner2 :: TFT17_Samira","n":355,"avg_placement":5.135,"top4_rate":0.3803,"win_rate":0.0535,"stderr":0.111,"lift_vs_comp":0.481,"lift_vs_field":0.632},{"augment":"TFT17_Augment_SalvageBin","comp":"Stargazer4_Vanguard2 :: TFT17_Xayah","n":418,"avg_placement":4.66,"top4_rate":0.4809,"win_rate":0.0861,"stderr":0.111,"lift_vs_comp":0.556,"lift_vs_field":0.157},{"augment":"TFT17_Augment_Featherweights","comp":"DarkStar4_Sniper2 :: TFT17_Jhin","n":147,"avg_placement":6.17,"top4_rate":0.1973,"win_rate":0.0136,"stderr":0.159,"lift_vs_comp":0.636,"lift_vs_field":1.667},{"augment":"TFT17_Augment_SalvageBin","comp":"Stargazer3_Sorcerer2 :: TFT17_Vex","n":268,"avg_placement":5.265,"top4_rate":0.3731,"win_rate":0.0373,"stderr":0.127,"lift_vs_comp":0.922,"lift_vs_field":0.762}],"comp_names":{"Anima5_Duelist2 :: TFT17_Fiora":"5 Anima","Stargazer4_Vanguard2 :: TFT17_Xayah":"Stargazer Xayah","NOVA4_Duelist2 :: TFT17_Akali":"N.O.V.A. Akali","Stargazer3_Sorcerer2 :: TFT17_Vex":"Vex Fast 9","Bruiser4_Gunner2 :: TFT17_Samira":"Two Tanky Samira","Brawler6_Duelist2 :: TFT17_MasterYi":"Brawler Yi","Shepherd4_Sorcerer2 :: TFT17_LeBlanc":"Shepherd LeBlanc","DarkStar4_Sniper2 :: TFT17_Jhin":"Dark Stars","Sorcerer6_Shepherd2 :: TFT17_Lulu":"Lulu Reroll"},"augment_names":{"TFT17_Augment_Featherweights":"Featherweights","TFT17_Augment_ComponentGrabBag":"Component Grab Bag","TFT17_Augment_SalvageBin":"Salvage Bin","TFT17_Augment_DiamondHands":"Diamond Hands","TFT17_Augment_TradeSector":"Trade Sector","TFT17_Augment_PandorasItems":"Pandoras Items","TFT17_Augment_HedgeFund":"Hedge Fund","TFT17_Augment_StandUnited":"Stand United","TFT17_Augment_RichGetRicher":"Rich Get Richer","TFT17_Augment_BuiltDifferent":"Built Different","TFT17_Augment_Preparation":"Preparation","TFT17_Augment_FastForward":"Fast Forward"},"slice_id":"global-apex","slice_label":"Challenger + GM","generated_at":1786582731,"is_fallback":true}
;

function StatusBanner({ status, error, onRetry }) {
  if (status === "live") return null;
  const cfg = {
    loading: { Icon: RefreshCw, c: "var(--dim)", t: "Loading published stats…", spin: true },
    offline: { Icon: WifiOff, c: "var(--warn)", t: "Can't reach the stats feed — showing a bundled snapshot. These numbers are not current." },
    error:   { Icon: AlertTriangle, c: "var(--warn)", t: "Refresh failed — showing the last data that loaded." },
  }[status];
  if (!cfg) return null;
  const { Icon } = cfg;
  return (
    <div className="flex items-start gap-2 text-[11.5px] rounded px-3 py-2 border mb-4"
         style={{ color: cfg.c, borderColor: cfg.c + "33", background: cfg.c + "0A" }}>
      <Icon size={13} className={`mt-[2px] shrink-0 ${cfg.spin ? "animate-spin" : ""}`} />
      <span className="flex-1">
        {cfg.t}
        {error && status !== "loading" && (
          <span className="opacity-60 ml-1.5 font-mono text-[10px]">({error})</span>
        )}
      </span>
      {status !== "loading" && <button onClick={onRetry} className="underline shrink-0">Retry</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function useStatsFeed() {
  const [manifest, setManifest] = useState(null);
  const [sliceId, setSliceId] = useState(null);
  const [stats, setStats] = useState(FALLBACK_STATS);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const refresh = useCallback(async (wanted) => {
    setStatus((s) => (s === "live" ? "live" : "loading"));
    try {
      const mr = await fetch(urlFor("manifest"), { cache: "no-cache" });
      if (!mr.ok) throw new Error(`manifest ${mr.status}`);
      const m = await mr.json();
      setManifest(m);
      const id = wanted || m.default_slice || m.slices[0]?.id;
      if (!id) throw new Error("manifest lists no slices");
      const sr = await fetch(urlFor(id));
      if (!sr.ok) throw new Error(`slice ${sr.status}`);
      setStats(await sr.json());
      setSliceId(id);
      setStatus("live");
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
      setStatus((p) => (p === "live" ? "error" : "offline"));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => sliceId && refresh(sliceId), REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh, sliceId]);

  return { manifest, stats, sliceId, setSlice: refresh, status, error };
}

// Set reference catalogues: item tooltips, the live set's champion roster, and
// the augment pool. Not match-derived, so they're fetched once and shared
// across every slice rather than re-fetched on slice switches, and they
// degrade to stats-only rather than emptying a tab if the fetch fails.
//
// These matter beyond tooltips: the Champions and Augments tabs are driven by
// the catalogue rather than by the stats, so they show the whole roster/pool
// instead of only the entries that cleared the crawl's sample floor.
//
// `version` busts the HTTP cache when a new build is published. These files are
// served with a long max-age (they change only on republish), so without a
// versioned URL a browser will keep serving the copy it already has -- which
// silently hides any field added since, rather than failing visibly.
function useCatalog(name, version) {
  const [catalog, setCatalog] = useState({});
  useEffect(() => {
    const base = STATIC_MODE ? `${API_BASE}/${name}.json` : `${API_BASE}/${name}`;
    const url = version ? `${base}?v=${version}` : base;
    fetch(url)
      .then((r) => (r.ok ? r.json() : {}))
      .then(setCatalog)
      .catch(() => {});
  }, [name, version]);
  return catalog;
}

export default function App() {
  const { manifest, stats, sliceId, setSlice, status, error } = useStatsFeed();
  const catalogVersion = manifest?.generated_at;
  const itemMeta = useCatalog("item-meta", catalogVersion);
  const championMeta = useCatalog("champion-meta", catalogVersion);
  const augmentMeta = useCatalog("augment-meta", catalogVersion);
  const traitMeta = useCatalog("trait-meta", catalogVersion);
  const [tab, setTab] = useState("advisor");
  const [openComp, setOpenComp] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [sliceMenu, setSliceMenu] = useState(false);

  // One ranking, unconditioned. The augment-conditional projection this used to
  // carry is gone: tft-match-v1 doesn't report augments, so augment_comp_pairs
  // is always empty and every "projected" value equalled the baseline anyway.
  const pairIndex = useMemo(() => buildIndex(stats), [stats]);
  const baseline = useMemo(
    () => evaluate(stats, pairIndex, new Map(), [null, null, null]),
    [stats, pairIndex]);

  const activeSlice = manifest?.slices?.find((s) => s.id === sliceId);

  // Rows handed over by the Planner aren't from `baseline`, so fall back to
  // whatever the caller passed rather than dropping the modal.
  const openCompLive = openComp
    ? (baseline.find((c) => c.sig === openComp.sig) || openComp)
    : null;

  return (
    <div className="min-h-screen w-full" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
        :root {
          --bg:      #090B10;
          --surface: #11141C;
          --raised:  #161A24;
          --line:    #232936;
          --faint:   #2C3444;
          --ink-3:   #3D4658;
          /* Secondary text. --faint (#2C3444) reads at 1.58:1 on --bg, well
             under the 4.5:1 WCAG AA needs for body text, and it was carrying
             real content -- sample sizes, section labels, every statistical
             caveat. --faint stays for what it's actually suited to: bars,
             fills and the scrollbar thumb, none of which are read. */
          /* Sized against --raised, the lightest surface it sits on, so it
             clears 4.5:1 everywhere rather than only on the page background:
             5.10 on --bg, 4.77 on --surface, 4.51 on --raised. */
          --muted:   #7282A4;
          --dim:     #78839A;
          --text:    #E4E8F0;
          --signal:  #46E0B0;
          --accent:  #FFC24B;
          --warn:    #E8A33D;
          --danger:  #FF7A85;
        }
        * { box-sizing: border-box; }
        body { font-family: 'Inter', system-ui, sans-serif; }
        .display { font-family: 'Chakra Petch', sans-serif; letter-spacing: 0.01em; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        /* Height as well as width: the tab strip and the stats tables scroll
           HORIZONTALLY, and a rule that sets only width leaves those with the
           browser's ~15px default bar -- a grey slab across the header once
           the tabs outgrow the viewport. */
        .scroll-thin::-webkit-scrollbar { width: 5px; height: 5px; }
        .scroll-thin::-webkit-scrollbar-thumb { background: var(--faint); border-radius: 3px; }
        .scroll-thin::-webkit-scrollbar-track { background: transparent; }
        /* Keyboard focus. Inputs set outline-none for their own focus style,
           which left every button and link with no visible focus at all --
           tabbing through the app gave no indication of where you were.
           :focus-visible keeps mouse clicks from drawing a ring. */
        :focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: 3px;
        }
        .row-hover { transition: background 140ms ease, border-color 140ms ease; }
        .row-hover:hover { background: var(--raised); border-color: var(--ink-3); }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      {/* Header */}
      <header className="border-b sticky top-0 z-30 backdrop-blur"
              style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
        <div className="max-w-[1180px] mx-auto px-6 h-[62px] flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            {/* The page had no h1 at all -- the wordmark was a span, which
                left screen readers and search engines with no document
                heading. Styling is unchanged. */}
            <h1 className="display text-[19px] font-bold tracking-tight">
              HEXCALL
            </h1>
            <span className="text-[11px] mono truncate" style={{ color: "var(--dim)" }}>
              patch {stats.patch || "—"} · {stats.sample_size.toLocaleString()} boards · {timeAgo(stats.generated_at)}
              {status === "live" && <span style={{ color: "var(--signal)" }}> · live</span>}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {manifest?.slices?.length > 0 && (
              <div className="relative">
                <button onClick={() => setSliceMenu((v) => !v)}
                        className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded border row-hover"
                        style={{ borderColor: "var(--line)" }}>
                  <Database size={12} style={{ color: "var(--dim)" }} />
                  {activeSlice?.label || "Data slice"}
                  <ChevronRight size={11} className="rotate-90" style={{ color: "var(--dim)" }} />
                </button>
                {sliceMenu && (
                  <div className="absolute right-0 mt-1.5 w-64 rounded border py-1 z-40"
                       style={{ background: "var(--raised)", borderColor: "var(--line)" }}>
                    {manifest.slices.map((s) => (
                      <button key={s.id}
                              onClick={() => { setSlice(s.id); setSliceMenu(false); }}
                              className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 row-hover">
                        <div className="min-w-0">
                          <p className="text-[12px] truncate">{s.label}</p>
                          <p className="text-[10px] mono" style={{ color: "var(--dim)" }}>
                            {s.sample_size.toLocaleString()} boards
                          </p>
                        </div>
                        {s.id === sliceId && <Check size={13} style={{ color: "var(--signal)" }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setSlice(sliceId)} title="Refresh"
                    className="p-1.5 rounded border row-hover" style={{ borderColor: "var(--line)" }}>
              <RefreshCw size={12} className={status === "loading" ? "animate-spin" : ""}
                         style={{ color: "var(--dim)" }} />
            </button>
            <button onClick={() => setShowInfo(true)}
                    className="p-1.5 rounded border row-hover" style={{ borderColor: "var(--line)" }}>
              <Info size={12} style={{ color: "var(--dim)" }} />
            </button>
          </div>
        </div>

        {/* Announced as a tab set rather than nine unrelated buttons: without
            the roles a screen reader gives no sense of how many there are or
            which one is showing. */}
        <div role="tablist" aria-label="Sections"
             className="max-w-[1180px] mx-auto px-6 flex gap-1 -mb-px overflow-x-auto scroll-thin">
          {[
            ["advisor", "Advisor", Sparkles],
            ["planner", "Items I hold", Layers],
            ["comps", "Comps", Swords],
            ["augments", "Augments", Zap],
            ["champions", "Units", Zap],
            ["items", "Items", Hexagon],
            ["traits", "Traits", Users],
            ["trends", "Trends", TrendingUp],
            ["review", "Review My Games", History],
          ].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
                    role="tab" aria-selected={tab === id} id={`tab-${id}`}
                    className="display text-[13px] font-medium py-2.5 px-3 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors"
                    style={{
                      borderColor: tab === id ? "var(--accent)" : "transparent",
                      color: tab === id ? "var(--text)" : "var(--dim)",
                    }}>
              <Icon size={13} style={{ color: tab === id ? "var(--accent)" : "var(--muted)" }} />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* One panel that swaps content, so it points back at whichever tab is
          selected rather than there being nine panels in the DOM. */}
      <main role="tabpanel" aria-labelledby={`tab-${tab}`}
            className="max-w-[1180px] mx-auto px-6 py-6">
        <StatusBanner status={status} error={error} onRetry={() => setSlice(sliceId)} />

        {tab === "advisor" && (
          <Advisor stats={stats} augmentMeta={augmentMeta} itemMeta={itemMeta}
                   traitMeta={traitMeta} onOpenComp={setOpenComp} />
        )}

        {tab === "planner" && (
          <Planner stats={stats} itemMeta={itemMeta} onOpenComp={setOpenComp} />
        )}

        {tab === "comps" && (
          <CompsTab stats={stats} traitMeta={traitMeta} itemMeta={itemMeta}
                    apiBase={API_BASE} staticMode={STATIC_MODE} sliceId={sliceId}
                    onOpenComp={setOpenComp} />
        )}

        {tab === "augments" && <AugmentsTab augmentMeta={augmentMeta} championMeta={championMeta} traitMeta={traitMeta} />}

        {tab === "champions" && <ChampionsTab stats={stats} championMeta={championMeta}
                                              itemMeta={itemMeta} traitMeta={traitMeta} />}

        {tab === "items" && <ItemsTab stats={stats} itemMeta={itemMeta} />}

        {tab === "traits" && <TraitsTab stats={stats} traitMeta={traitMeta}
                                        championMeta={championMeta} />}

        {tab === "trends" && <TrendsTab stats={stats} apiBase={API_BASE} staticMode={STATIC_MODE}
                                        sliceId={sliceId} traitMeta={traitMeta} />}

        {tab === "review" && <Review apiBase={API_BASE} sliceId={sliceId} staticMode={STATIC_MODE}
                                     traitMeta={traitMeta} />}
      </main>

      {/* Riot's third-party policy requires this acknowledgement in the
          product itself, not only in the repo's README. */}
      <footer className="max-w-[1180px] mx-auto px-6 py-6 mt-4 border-t"
              style={{ borderColor: "var(--line)" }}>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <p className="text-[10.5px] leading-relaxed max-w-[640px]" style={{ color: "var(--dim)" }}>
            HexCall isn't endorsed by Riot Games and doesn't reflect the views or opinions of
            Riot Games or anyone officially involved in producing or managing Riot Games
            properties. Riot Games and all associated properties are trademarks or registered
            trademarks of Riot Games, Inc. Match data is retrieved from the Riot Games API;
            champion, item and trait assets come from Data Dragon and Community Dragon.
          </p>
          <nav className="flex items-center gap-4 text-[11px] shrink-0">
            <a href={`${import.meta.env.BASE_URL}privacy.html`}
               className="underline" style={{ color: "var(--dim)" }}>Privacy</a>
            <a href={`${import.meta.env.BASE_URL}terms.html`}
               className="underline" style={{ color: "var(--dim)" }}>Terms</a>
            <button onClick={() => setShowInfo(true)} className="underline" style={{ color: "var(--dim)" }}>
              How it works
            </button>
          </nav>
        </div>
      </footer>

      {/* Comp detail */}
      {openComp && (
        // The dialog is a fixed-height box that scrolls internally, rather than
        // a tall page-scrolling panel. Comp detail is long enough to exceed any
        // viewport, and letting it grow made it run flush to the window edges.
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
             style={{ background: "rgba(4,6,10,0.82)", backdropFilter: "blur(2px)" }}
             onClick={() => setOpenComp(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="w-full max-w-3xl lg:max-w-5xl rounded-xl border shadow-2xl flex flex-col"
               style={{ background: "var(--raised)", borderColor: "var(--line)", maxHeight: "min(88vh, 900px)" }}>

            {/* Header stays put while the body scrolls under it */}
            <div className="flex items-start gap-3.5 p-5 pb-3.5 border-b shrink-0"
                 style={{ borderColor: "var(--line)" }}>
              <ChampionIcon src={stats.champion_icons?.[carryIdFromSig(openCompLive.sig)]} name={openCompLive.name} size={44} />
              <div className="min-w-0 flex-1">
                <h3 className="display text-[19px] truncate">{openCompLive.name}</h3>
                <p className="mono text-[10px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>{openCompLive.sig}</p>
              </div>
              <button onClick={() => setOpenComp(null)} className="shrink-0 p-1 rounded row-hover"
                      style={{ color: "var(--dim)" }} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto scroll-thin p-5 pt-4">
            <div className="mb-4">
              <AxisLegend className="mb-1" />
              <PlacementTrack base={openCompLive.avg_placement} projected={openCompLive.projected}
                              stderr={openCompLive.stderr} rank={-1} shifted={false} />
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                ["baseline", openCompLive.avg_placement.toFixed(2)],
                ["projected", openCompLive.projected.toFixed(2)],
                ["sample", openCompLive.n.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="rounded border px-2.5 py-2" style={{ borderColor: "var(--line)" }}>
                  <p className="text-[9.5px] uppercase tracking-wider mb-0.5" style={{ color: "var(--dim)" }}>{label}</p>
                  <p className="mono text-[17px] font-bold">{value}</p>
                </div>
              ))}
            </div>

            {/* Build detail */}
            <div className="mb-5 pb-5 border-b" style={{ borderColor: "var(--line)" }}>
              <CompBuild apiBase={API_BASE} staticMode={STATIC_MODE} sliceId={sliceId}
                         slug={stats.comp_slugs?.[openCompLive.sig]}
                         selectedAugments={[]} augmentNames={stats.augment_names}
                         augmentIcons={stats.augment_icons} itemMeta={itemMeta}
                         traitMeta={traitMeta} augmentMeta={augmentMeta}
                         compPairs={stats.augment_comp_pairs.filter((p) => p.comp === openCompLive.sig)}
                         baseline={stats.baseline_placement} />
            </div>

            {openCompLive.contributions.length > 0 ? (
              <div className="rounded border p-3" style={{ borderColor: "var(--line)" }}>
                <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--dim)" }}>
                  augment contribution
                </p>
                <div className="space-y-2">
                  {openCompLive.contributions.map((c) => (
                    <div key={c.augment} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <AugmentIcon src={stats.augment_icons?.[c.augment]} name={c.name} size={20} />
                        <div className="min-w-0">
                        <p className="text-[12px] truncate">{c.name}</p>
                        <p className="mono text-[9.5px]" style={{ color: "var(--dim)" }}>
                          {c.pairAvg.toFixed(2)} avg here · n={c.n.toLocaleString()}
                          {Math.abs(c.applied) < Math.abs(c.rawLift) * 0.9 &&
                            ` · shrunk from ${c.rawLift > 0 ? "+" : ""}${c.rawLift.toFixed(2)}`}
                        </p>
                        </div>
                      </div>
                      <span className="mono text-[13px] shrink-0"
                            style={{ color: c.applied < 0 ? "var(--signal)" : "var(--danger)" }}>
                        {c.applied > 0 ? "+" : ""}{c.applied.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                {openCompLive.missing > 0 && (
                  <p className="text-[10.5px] mt-2.5" style={{ color: "var(--warn)" }}>
                    {openCompLive.missing} augment has too few games with this comp to measure. Ranking is provisional.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--dim)" }}>
                Pick augments to see how they shift this comp.
              </p>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Info */}
      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
             style={{ background: "rgba(4,6,10,0.82)", backdropFilter: "blur(2px)" }}
             onClick={() => setShowInfo(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="w-full max-w-md rounded-xl border p-5 relative shadow-2xl overflow-y-auto scroll-thin"
               style={{ maxHeight: "min(88vh, 900px)",
                        background: "var(--raised)", borderColor: "var(--line)" }}>
            <button onClick={() => setShowInfo(false)} className="absolute top-4 right-4" style={{ color: "var(--dim)" }}>
              <X size={15} />
            </button>
            <h3 className="display text-[15px] mb-3">How this works</h3>

            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>reading the track</p>
            <p className="text-[12.5px] leading-relaxed mb-3">
              Each row is the placement axis, 1 through 8. The diamond is where the comp lands
              with your augments; the grey tick is where it sits without them. The pale bar
              behind it is the 95% confidence interval — when two comps' intervals overlap,
              the gap between them isn't real.
            </p>

            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--dim)" }}>the model</p>
            <p className="mono text-[11px] rounded p-2.5 mb-2 leading-relaxed"
               style={{ background: "var(--bg)", color: "var(--signal)" }}>
              projected = comp.avg + Σ lift(augment, comp)
            </p>
            <p className="text-[12.5px] leading-relaxed mb-3">
              Lifts shrink toward zero by sample size, so a big swing measured on 40 games
              counts far less than the same swing on 1,200. Without that, the top of the list
              fills with noise.
            </p>

            <p className="text-[11px] leading-relaxed" style={{ color: "var(--dim)" }}>
              You enter your own augments; the app never reads game state and gives no real-time
              in-game prescriptions. Legend augment statistics are excluded entirely. Both are
              requirements of Riot's TFT third-party policy.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
