import { useMemo } from 'react';
import {
  ArrowLeftRight, Bike, CalendarDays, Car, Compass, Heart, HelpCircle, LayoutDashboard,
  LifeBuoy, MapPin, Sparkles, User, UserPlus,
} from 'lucide-react';
import CommandPalette from './CommandPalette.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { readRecent } from '../lib/recently.js';
import { buildPaletteItems, filterPaletteItems } from '../lib/paletteItems.js';

const ICONS = {
  car: Car,
  bike: Bike,
  compare: ArrowLeftRight,
  calendar: CalendarDays,
  heart: Heart,
  user: User,
  userPlus: UserPlus,
  admin: LayoutDashboard,
  compass: Compass,
  map: MapPin,
  sparkles: Sparkles,
  lifeBuoy: LifeBuoy,
  help: HelpCircle,
};

/**
 * Customer-facing ⌘K palette. It mirrors the console palette's keyboard model
 * while surfacing storefront pages, hubs, vehicle types and recently viewed
 * vehicles — all with Admin → Content labels.
 */
export default function SiteCommandPalette({ open, onClose }) {
  const { user, isStaff } = useAuth();
  const { meta } = useMeta();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);

  const items = useMemo(() => {
    const built = buildPaletteItems({
      content,
      meta,
      user,
      isStaff,
      recent: readRecent(5),
    });
    return built.map((item) => ({ ...item, icon: ICONS[item.icon] || Car }));
  }, [content, isStaff, meta, user]);

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      items={items}
      filter={filterPaletteItems}
      title={content.palette_title}
      placeholder={content.palette_placeholder}
      emptyText={content.palette_empty}
      closeLabel={content.palette_close}
      hintOpen={content.palette_hint_open}
      hintMove={content.palette_hint_move}
      hintClose={content.palette_hint_close}
      resultsOne={content.palette_results_one}
      resultsMany={content.palette_results_many}
      groupLabels={{
        pages: content.palette_group_pages,
        types: content.palette_group_types,
        actions: content.palette_group_actions,
        recent: content.palette_group_recent,
        hubs: content.palette_group_hubs,
      }}
    />
  );
}