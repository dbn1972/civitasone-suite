import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Products", description: "Browse the products and services list.", href: "/catalogue/products" },
	{ title: "Categories", description: "Browse the product category hierarchy.", href: "/catalogue/categories" },
	{ title: "Rates", description: "Browse effective-dated rate cards.", href: "/catalogue/rates" },
	{ title: "Bundles", description: "Browse product bundles and combo offerings.", href: "/catalogue/bundles" },
];

export default function Page() {
	return (
		<div className="page-main">
			<PageHeader title="Service Catalogue" subtitle="Products, services, and rate management." />
			<LinkTiles tiles={sections} columns="four" />
		</div>
	);
}
