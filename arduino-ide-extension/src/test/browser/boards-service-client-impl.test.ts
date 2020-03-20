import { expect } from 'chai';
import { Container, injectable } from 'inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { MockLogger } from '@theia/core/lib/common/test/mock-logger';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { BoardsService, Board, Port, BoardsPackage, BoardDetails, BoardsServiceClient, AttachedSerialBoard } from '../../common/protocol';
import { BoardsServiceClientImpl, AvailableBoard } from '../../browser/boards/boards-service-client-impl';
import { BoardsConfig } from '../../browser/boards/boards-config';

// tslint:disable: no-unused-expression   

describe('boards-service-client-impl', () => {

    describe('onAvailableBoardsChanged', () => {

        const ESP8266: Port = { protocol: 'serial', address: '/dev/cu.SLAB_USBtoUART' };
        const UNO: AttachedSerialBoard = { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', port: '/dev/cu.usbmodem14501' };
        const MKR1000: AttachedSerialBoard = { name: 'Arduino MKR1000', fqbn: 'arduino:samd:mkr1000', port: '/dev/cu.usbmodem14601' };
        const NANO: Board = { name: 'Arduino Nano', fqbn: 'arduino:avr:nano' };

        const recognized = AvailableBoard.State.recognized;
        const guessed = AvailableBoard.State.guessed;
        const incomplete = AvailableBoard.State.incomplete;

        let server: MockBoardsService;
        let client: BoardsServiceClientImpl;
        // let storage: MockStorageService;

        beforeEach(() => {
            const container = init();
            server = container.get(MockBoardsService);
            client = container.get(BoardsServiceClientImpl);
            // storage = container.get(MockStorageService);
            server.setClient(client);
        });

        it('should have no available boards by default', () => {
            expect(client.availableBoards).to.have.length(0);
        });

        it('should be notified when a board is attached', async () => {
            await attach(MKR1000);
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(recognized);
            expect(!!availableBoards()[0].selected).to.be.false;
        });

        it('should be notified when a unknown board is attached', async () => {
            await attach(ESP8266);
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(incomplete);
        });

        it('should be notified when a board is detached', async () => {
            await attach(MKR1000, UNO, ESP8266);
            expect(availableBoards()).to.have.length(3);
            await detach(MKR1000);
            expect(availableBoards()).to.have.length(2);
        });

        it('should be notified when an unknown board is detached', async () => {
            await attach(MKR1000, UNO, ESP8266);
            expect(availableBoards()).to.have.length(3);
            await detach(ESP8266);
            expect(availableBoards()).to.have.length(2);
        });

        it('should recognize boards config as an available board', async () => {
            await configureBoards({ selectedBoard: NANO });
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(incomplete);
            expect(availableBoards()[0].selected).to.be.true;
        });

        it('should discard the boards config port when corresponding board is detached', async () => {
            await attach(MKR1000);
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(recognized);
            expect(availableBoards()[0].selected).to.be.false;

            await configureBoards({ selectedBoard: MKR1000, selectedPort: server.portFor(MKR1000) });
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(recognized);
            expect(availableBoards()[0].selected).to.be.true;

            await detach(MKR1000);
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(incomplete);
            expect(availableBoards()[0].selected).to.be.true;
        });

        it("should consider selected unknown boards as 'guessed'", async () => {
            await attach(ESP8266);
            await configureBoards({ selectedBoard: { name: 'guessed' }, selectedPort: ESP8266 });
            expect(availableBoards()).to.have.length(1);
            expect(availableBoards()[0].state).to.be.equal(guessed);
            expect(availableBoards()[0].name).to.be.equal('guessed');
            expect(availableBoards()[0].fqbn).to.be.undefined;
            expect(client.canVerify(client.boardsConfig)).to.be.true;
        });

        function availableBoards(): AvailableBoard[] {
            return client.availableBoards.slice();
        }

        async function configureBoards(config: BoardsConfig.Config): Promise<void> {
            return new Promise<void>(async resolve => {
                const availableBoardsChanged = new Deferred<void>();
                client.onAvailableBoardsChanged(() => availableBoardsChanged.resolve());
                client.boardsConfig = config;
                await availableBoardsChanged.promise;
                resolve();
            });
        }

        async function detach(...toDetach: Array<Board | Port>): Promise<void> {
            return new Promise<void>(async resolve => {
                const attachedBoardsChanged = new Deferred<void>();
                const availableBoardsChanged = new Deferred<void>();
                client.onAttachedBoardsChanged(() => attachedBoardsChanged.resolve());
                client.onAvailableBoardsChanged(() => availableBoardsChanged.resolve());
                server.detach(...toDetach);
                await Promise.all([
                    attachedBoardsChanged.promise,
                    availableBoardsChanged.promise
                ]);
                resolve();
            });
        }

        async function attach(...toAttach: Array<Board | Port>): Promise<void> {
            return new Promise<void>(async resolve => {
                const attachedBoardsChanged = new Deferred<void>();
                const availableBoardsChanged = new Deferred<void>();
                client.onAttachedBoardsChanged(() => attachedBoardsChanged.resolve());
                client.onAvailableBoardsChanged(() => availableBoardsChanged.resolve());
                server.attach(...toAttach);
                await Promise.all([
                    attachedBoardsChanged.promise,
                    availableBoardsChanged.promise
                ]);
                resolve();
            });
        }

    });

});

function init(): Container {
    const container = new Container({ defaultScope: 'Singleton' });
    container.bind(MockBoardsService).toSelf();
    container.bind(MockLogger).toSelf();
    container.bind(ILogger).toService(MockLogger);
    container.bind(MockStorageService).toSelf();
    container.bind(StorageService).toService(MockStorageService);
    container.bind(BoardsServiceClientImpl).toSelf();

    return container;
}

@injectable()
export class MockBoardsService implements BoardsService {

    private client: BoardsServiceClient | undefined;

    boards: Board[] = [];
    ports: Port[] = [];

    attach(...toAttach: Array<Board | Port>): void {
        const oldState = { boards: this.boards.slice(), ports: this.ports.slice() };
        for (const what of toAttach) {
            if (Board.is(what)) {
                if (AttachedSerialBoard.is(what)) {
                    this.ports.push({ protocol: 'serial', address: what.port });
                }
                this.boards.push(what);
            } else {
                this.ports.push(what);
            }
        }
        const newState = { boards: this.boards, ports: this.ports };
        if (this.client) {
            this.client.notifyAttachedBoardsChanged({ oldState, newState });
        }
    }

    detach(...toRemove: Array<Board | Port>): void {
        const oldState = { boards: this.boards.slice(), ports: this.ports.slice() };
        for (const what of toRemove) {
            if (Board.is(what)) {
                const index = this.boards.indexOf(what);
                if (index === -1) {
                    throw new Error(`${what} board is not attached. Boards were: ${JSON.stringify(oldState.boards)}`);
                }
                this.boards.splice(index, 1);
                if (AttachedSerialBoard.is(what)) {
                    const portIndex = this.ports.findIndex(({ protocol, address }) => protocol === 'serial' && address === what.port);
                    if (portIndex === -1) {
                        throw new Error(`${what} port is not available. Ports were: ${JSON.stringify(oldState.ports)}`);
                    }
                    this.ports.splice(portIndex, 1);
                }
            } else {
                const index = this.ports.indexOf(what);
                if (index === -1) {
                    throw new Error(`${what} port is not available. Ports were: ${JSON.stringify(oldState.ports)}`);
                }
                this.ports.splice(index, 1);
            }
        }
        const newState = { boards: this.boards, ports: this.ports };
        if (this.client) {
            this.client.notifyAttachedBoardsChanged({ oldState, newState });
        }
    }

    reset(): void {
        this.setState({ boards: [], ports: [], silent: true });
    }

    setState({ boards, ports, silent }: { boards: Board[], ports: Port[], silent?: boolean }): void {
        const oldState = { boards: this.boards, ports: this.ports };
        const newState = { boards, ports };
        if (this.client && !silent) {
            this.client.notifyAttachedBoardsChanged({ oldState, newState });
        }
    }

    portFor(board: AttachedSerialBoard): Port {
        const port = this.ports.find(({ protocol, address }) => protocol === 'serial' && address === board.port);
        if (!port) {
            throw new Error(`Could not find port for board: ${JSON.stringify(board)}. Ports were: ${JSON.stringify(this.ports)}.`);
        }
        return port;
    }

    // BoardsService API

    async getAttachedBoards(): Promise<Board[]> {
        return this.boards;
    }

    async getAvailablePorts(): Promise<Port[]> {
        throw this.ports;
    }

    async getBoardDetails(): Promise<BoardDetails> {
        throw new Error('Method not implemented.');
    }

    getBoardPackage(): Promise<BoardsPackage> {
        throw new Error('Method not implemented.');
    }

    getContainerBoardPackage(): Promise<BoardsPackage> {
        throw new Error('Method not implemented.');
    }

    searchBoards(): Promise<Array<Board & { packageName: string; }>> {
        throw new Error('Method not implemented.');
    }

    install(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    uninstall(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    search(): Promise<BoardsPackage[]> {
        throw new Error('Method not implemented.');
    }

    dispose(): void {
        this.reset();
        this.client = undefined;
    }

    setClient(client: BoardsServiceClient | undefined): void {
        this.client = client;
    }

}

@injectable()
class MockStorageService implements StorageService {

    private store: Map<string, any> = new Map();

    reset(): void {
        this.store.clear();
    }

    async setData<T>(key: string, data: T): Promise<void> {
        this.store.set(key, data);
    }

    async getData<T>(key: string): Promise<T | undefined>;
    async getData<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        const data = this.store.get(key);
        return data ? data : defaultValue;
    }

}
