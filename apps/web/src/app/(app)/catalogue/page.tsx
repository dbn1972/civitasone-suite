import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Products", description: "Manage product catalogue with variants and pricing.", href: "/catalogue/products" },
	{ title: "Categories", description: "Hierarchical product category tree.", href: "/catalogue/categories" },
	{ title: "Rates", description: "Effective-dated rate cards and pricing rules.", href: "/catalogue/rates" },
	{ title: "Bundles", description: "Product bundles and combo offerings.", href: "/catalogue/bundles" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Service Catalogue" subtitle="Products, services, and rate management." help="catalogue" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}
