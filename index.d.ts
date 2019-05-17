/// <reference types="node" />
import EventEmitter = require('events');
declare enum NodeType {
    data = 0,
    task = 1
}
declare enum TaskState {
    waiting = 0,
    done = 1,
    fail = 2
}
declare type Data = any;
interface DataNode {
    type: NodeType;
    data: Data;
}
interface TaskNode {
    type: NodeType;
    state: TaskState;
    template: string;
    url: string;
    children: (TaskNode | DataNode)[];
}
interface Options {
    /**
     * 同时进行的任务数
     */
    thread?: number;
    /**
     * 相邻任务执行最短时间间隔，单位毫秒
     */
    interval?: number;
    /**
     * 是否根据URL去重
     */
    distinct?: boolean;
}
interface AddFunc {
    /**
     * 添加爬行任务
     */
    (template: string, url: string): void;
    /**
     * 添加数据
     */
    (data: Data): void;
}
interface TemplateFunc {
    /**
     * 任务执行函数，在使用该模板的任务执行时被调用，被调用时会传入`url`和`add`参数
     * @param url 该任务的URL
     * @param add 用于添加爬行任务或数据的函数
     * @returns 任务成功时变为resolved，失败时变为rejected的Promise
     */
    (url: string, add: AddFunc): Promise<any>;
}
declare class Nekopara extends EventEmitter {
    private options;
    private crawlTree;
    private urlSet;
    private taskQueue;
    private templates;
    private delayQueue;
    private stopped;
    constructor(opts?: Options);
    /**
     * 调用该函数创建一个Pormise实例，创建多个Promise实例时，它们会至少间隔opts.interval毫秒变为fulfilled
     */
    private createDelayPromise;
    private addTask;
    private createAddFunc;
    /**
     * 注册爬行模板
     * @param template 模板名称
     * @param func 模板函数
     */
    register(template: string, func: TemplateFunc): void;
    /**
     * 获取爬行结果
     * @returns 包含`list`和`complete`字段的对象，`list`为当前已爬行的数据集合，`complete`在爬行未完成或存在错误节点时值为`false`
     */
    getResults(): {
        list: Data[];
        complete: boolean;
    };
    /**
     * 返回当前爬行进度的快照
     */
    snapshot(): TaskNode;
    /**
     * 终止爬行，任务列表中等待执行的任务将不会被执行
     * 调用该函数后将不会触发done事件
     */
    stop(): void;
    private onDone;
    /**
     * 从指定的入口页面开始爬行任务
     * @param template 爬行模板名称
     * @param url 入口页面URL
     */
    start(template: string, url: string): void;
    /**
     * 通过保存的爬行进度继续爬行，发生错误的任务也会重试
     * @param snapshot 调用snapshot方法返回的快照
     */
    start(snapshot: TaskNode): void;
    private startWithEntry;
    private startWithSnapshot;
}
export = Nekopara;
