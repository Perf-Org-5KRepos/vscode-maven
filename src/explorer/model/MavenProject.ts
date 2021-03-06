// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as fs from "fs";
import * as _ from "lodash";
import * as path from "path";
import * as vscode from "vscode";
import { Settings } from "../../Settings";
import { taskExecutor } from "../../taskExecutor";
import { getPathToExtensionRoot } from "../../utils/contextUtils";
import { Utils } from "../../utils/Utils";
import { EffectivePomProvider } from "../EffectivePomProvider";
import { mavenExplorerProvider } from "../mavenExplorerProvider";
import { IEffectivePom } from "./IEffectivePom";
import { ITreeItem } from "./ITreeItem";
import { MavenPlugin } from "./MavenPlugin";
import { PluginsMenu } from "./PluginsMenu";

const CONTEXT_VALUE: string = "MavenProject";

export class MavenProject implements ITreeItem {
    public parent?: MavenProject;
    public pomPath: string;
    private ePomProvider: EffectivePomProvider;
    private _ePom: any;
    private _pom: any;

    constructor(pomPath: string) {
        this.pomPath = pomPath;
        this.ePomProvider = new EffectivePomProvider(pomPath);
        taskExecutor.execute(async () => {
            try {
                await this.ePomProvider.calculateEffectivePom();
            } catch (error) {
                // ignore
            }
        });
    }

    public get name(): string {
        return _.get(this._pom, "project.artifactId[0]");
    }

    public get packaging(): string {
        return _.get(this._pom, "project.packaging[0]");
    }

    public get moduleNames(): string[] {
        const moduleNames: string[] | undefined = _.get(this._pom, "project.modules[0].module");
        return moduleNames ? moduleNames : [];
    }

    public get plugins(): MavenPlugin[] {
        let plugins: any[] | undefined;
        if (_.has(this._ePom, "projects.project")) {
            // multi-module project
            const project: any = (<any[]>this._ePom.projects.project).find((elem: any) => this.name === _.get(elem, "artifactId[0]"));
            if (project) {
                plugins = _.get(project, "build[0].plugins[0].plugin");
            }
        } else {
            // single-project
            plugins = _.get(this._ePom, "project.build[0].plugins[0].plugin");
        }
        return this._convertXmlPlugin(plugins);
    }

    public get dependencies(): any[] {
        let deps: any[] | undefined;
        if (_.has(this._ePom, "projects.project")) {
            // multi-module project
            const project: any = (<any[]>this._ePom.projects.project).find((elem: any) => this.name === _.get(elem, "artifactId[0]"));
            if (project) {
                deps = _.get(project, "build[0].plugins[0].plugin");
            }
        } else {
            // single-project
            deps = _.get(this._ePom, "project.dependencies[0].dependency");
        }
        return deps || [];
    }

    /**
     * @return list of absolute path of modules pom.xml.
     */
    public get modules(): string[] {
        return this.moduleNames.map(moduleName => {
            const relative: string = path.join(path.dirname(this.pomPath), moduleName);
            if (fs.existsSync(relative) && fs.statSync(relative).isFile()) {
                return relative;
            } else {
                return path.join(relative, "pom.xml");
            }
        });
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        await this.parsePom();
        const label: string = this.name ? this.name : "[Corrupted]";
        const iconFile: string = this.packaging === "pom" ? "root.svg" : "project.svg";
        const treeItem: vscode.TreeItem = new vscode.TreeItem(label);
        treeItem.iconPath = {
            light: getPathToExtensionRoot("resources", "icons", "light", iconFile),
            dark: getPathToExtensionRoot("resources", "icons", "dark", iconFile)
        };
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        return treeItem;
    }

    public getContextValue(): string {
        return CONTEXT_VALUE;
    }

    public getChildren(): ITreeItem[] {
        const ret: ITreeItem[] = [];
        ret.push(new PluginsMenu(this));
        if (this.moduleNames.length > 0 && Settings.viewType() === "hierarchical") {
            const projects: MavenProject[] = <MavenProject[]>this.modules.map(m => mavenExplorerProvider.getMavenProject(m)).filter(Boolean);
            ret.push(...projects);
        }
        return ret;
    }

    public async refreshEffectivePom(): Promise<void> {
        await this.ePomProvider.calculateEffectivePom();
    }

    public async getEffectivePom(): Promise<IEffectivePom> {
        let res: IEffectivePom = { pomPath: this.pomPath };
        try {
            res = await this.ePomProvider.getEffectivePom();
            this._ePom = res.ePom;
        } catch (error) {
            console.error(error);
        }
        return res;
    }

    public async refresh(): Promise<void> {
        await this._refreshPom();
    }

    public async parsePom(): Promise<void> {
        try {
            this._pom = await Utils.parseXmlFile(this.pomPath);
        } catch (error) {
            this._pom = undefined;
        }
    }

    private async _refreshPom(): Promise<void> {
        await this.parsePom();
        mavenExplorerProvider.refresh(this);
    }

    private _convertXmlPlugin(plugins: any[] | undefined): MavenPlugin[] {
        if (plugins && plugins.length > 0) {
            return plugins.map(p => new MavenPlugin(
                this,
                _.has(p, "groupId[0]") ? _.get(p, "groupId[0]") : "org.apache.maven.plugins",
                _.get(p, "artifactId[0]"),
                _.get(p, "version[0]")
            ));
        }
        return [];
    }
}
